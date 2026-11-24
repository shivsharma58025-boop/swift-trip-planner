/**
 * Swift Trip Planner - Parser.gs
 * Client: Swift Strips India Pvt. Ltd. (SLTT Group), Jamshedpur, Jharkhand, India
 * 
 * Natural language parser for WhatsApp inbound messages:
 * - English + Hinglish parsing (aaj, kal, parso, somwar, etc.)
 * - Typo-tolerant destinations (Kolkata, Haldia, Port, Dock, Howrah)
 * - Dates (relative days, weekdays, DD-MMM, DD/MM, DD MMM)
 * - Priority (urgent, emergency, jaldi) and DocType (invoice, LC, customs, bank)
 * - Status commands ("Booked 12814 28-Nov 06:10", "Departed", "Reached", "Delivered", "Returning", "Can't go")
 * - Sanitization of leading =, +, -, @ to prevent formula injection
 */

/**
 * Main Inbound WhatsApp Gateway
 */
function processInboundWhatsAppMessage(phone, text, messageId, timestamp) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var inboxSheet = ss.getSheetByName('Inbox');
  var staffSheet = ss.getSheetByName('Staff');
  var config = getConfigMap();

  var cleanPhone = phone.replace(/[^0-9]/g, '');
  var sender = identifyStaffByPhone(cleanPhone, staffSheet);
  var rawText = sanitizeInput(text);

  // 1. Duplicate check via Inbox tab
  if (isDuplicateMessage(messageId, inboxSheet)) {
    return {
      status: 'duplicate',
      replyTo: phone,
      text: "Duplicate message received and ignored."
    };
  }

  // 2. Rate limit check: max 20 messages per phone per hour
  if (isRateLimited(cleanPhone, inboxSheet)) {
    logInbox(inboxSheet, timestamp, phone, messageId, rawText, 'RATE_LIMIT', '', '', 'Rate limit exceeded (20/hr)', '');
    return {
      status: 'rate_limited',
      replyTo: phone,
      text: "Rate limit reached. Please wait a while before sending more requests."
    };
  }

  // 3. Sender authorization
  if (!sender) {
    logInbox(inboxSheet, timestamp, phone, messageId, rawText, 'UNREGISTERED', '', '', 'Unregistered phone number', '');
    return {
      status: 'unregistered',
      replyTo: phone,
      text: "Sorry, this phone number is not registered with Swift Strips Trip Planner. Please contact coordinator."
    };
  }

  // 4. Check if this is a Staff status command for their active trip
  var statusCmd = parseStatusCommand(rawText);
  if (statusCmd) {
    var updateResult = handleStaffStatusUpdate(sender, statusCmd, rawText);
    logInbox(inboxSheet, timestamp, phone, messageId, rawText, statusCmd.action, '', '', updateResult.status, updateResult.tripId || '');
    return {
      status: 'success',
      replyTo: phone,
      text: updateResult.reply
    };
  }

  // 5. Check if user is asking for trip status / info
  if (/^(status|my trip|next trip|meri trip)/i.test(rawText.trim())) {
    var summary = getStaffTripSummary(sender.name);
    logInbox(inboxSheet, timestamp, phone, messageId, rawText, 'TRIP_QUERY', '', '', 'Query answered', '');
    return {
      status: 'success',
      replyTo: phone,
      text: summary
    };
  }

  // 6. Otherwise parse trip booking request
  var parsed = parseTripRequest(rawText);

  // Check ambiguity / missing essentials
  if (!parsed.destination) {
    logInbox(inboxSheet, timestamp, phone, messageId, rawText, 'INCOMPLETE', '', '', 'Missing destination', '');
    return {
      status: 'incomplete',
      replyTo: phone,
      text: "Where is the trip to? Please mention destination (Kolkata, Haldia, Port) and date."
    };
  }

  if (!parsed.date) {
    logInbox(inboxSheet, timestamp, phone, messageId, rawText, 'INCOMPLETE', parsed.destination, '', 'Missing date', '');
    return {
      status: 'incomplete',
      replyTo: phone,
      text: "Which date is this trip for? (e.g., today/aaj, tomorrow/kal, or DD-MMM)."
    };
  }

  var dateStr = Utilities.formatDate(parsed.date, "Asia/Kolkata", "dd-MMM-yyyy");

  // 7. Role-based workflow:
  // Admin / Coordinator: create & auto-allot
  // Staff: creates 'Pending approval'
  var isCoordinator = (sender.role === 'Admin' || sender.role === 'Coordinator');

  var tripResult = createTripFromWhatsApp(parsed, sender, isCoordinator);

  logInbox(
    inboxSheet, timestamp, phone, messageId, rawText,
    isCoordinator ? 'AUTO_CREATE' : 'REQUEST_PENDING',
    parsed.destination, dateStr,
    tripResult.status, tripResult.tripId
  );

  return {
    status: 'success',
    replyTo: phone,
    text: tripResult.reply
  };
}

/**
 * Identifies staff by matching the last 10 digits of phone
 */
function identifyStaffByPhone(cleanPhone, staffSheet) {
  var data = staffSheet.getDataRange().getValues();
  var phone10 = cleanPhone.slice(-10);

  for (var i = 1; i < data.length; i++) {
    var staffPhone = String(data[i][1]).replace(/[^0-9]/g, '');
    if (staffPhone.slice(-10) === phone10) {
      return {
        name: data[i][0],
        phone: data[i][1],
        role: data[i][2],
        active: data[i][3],
        colour: data[i][4]
      };
    }
  }
  return null;
}

/**
 * Checks for duplicate messageId
 */
function isDuplicateMessage(messageId, inboxSheet) {
  if (!messageId) return false;
  var data = inboxSheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][2]).trim() === messageId) {
      return true;
    }
  }
  return false;
}

/**
 * Rate limit check: 20 per phone per hour
 */
function isRateLimited(cleanPhone, inboxSheet) {
  var phone10 = cleanPhone.slice(-10);
  var oneHourAgo = new Date(new Date().getTime() - 60 * 60 * 1000);
  var count = 0;

  var data = inboxSheet.getDataRange().getValues();
  for (var i = data.length - 1; i >= 1; i--) {
    var rowDate = data[i][0] ? new Date(data[i][0]) : null;
    if (rowDate && rowDate < oneHourAgo) break;

    var rowPhone = String(data[i][1]).replace(/[^0-9]/g, '');
    if (rowPhone.slice(-10) === phone10) {
      count++;
      if (count >= 20) return true;
    }
  }
  return false;
}

/**
 * Parse WhatsApp booking text for Destination, Date, Priority, DocType
 */
function parseTripRequest(text) {
  var t = text.toLowerCase();

  // 1. Destination Extraction
  var destination = '';
  if (/kolkata\s*port|calcutta\s*port|dock\s*port/i.test(t)) {
    destination = 'Kolkata Port';
  } else if (/haldia\s*dock|dock\s*haldia/i.test(t)) {
    destination = 'Haldia Dock';
  } else if (/kolkata|calcutta|howrah|hwh|src|santragachi/i.test(t)) {
    destination = 'Kolkata';
  } else if (/haldia|hlz/i.test(t)) {
    destination = 'Haldia';
  } else if (/port|dock/i.test(t)) {
    destination = 'Kolkata Port';
  }

  // 2. Priority
  var priority = 'Normal';
  if (/urgent|urgently|emergency|jaldi|turant|asap|priority/i.test(t)) {
    priority = 'Urgent';
  }

  // 3. DocType
  var docType = 'Other';
  if (/invoice|bill|chalan|challan/i.test(t)) {
    docType = 'Invoice';
  } else if (/\blc\b|letter of credit/i.test(t)) {
    docType = 'LC';
  } else if (/custom|customs|clearance/i.test(t)) {
    docType = 'Customs';
  } else if (/bank|cheque|draft|rtgs/i.test(t)) {
    docType = 'Bank';
  }

  // 4. Date parsing (relative & explicit)
  var date = parseDateFromText(t);

  return {
    destination: destination,
    date: date,
    priority: priority,
    docType: docType
  };
}

/**
 * Parses date from natural text (English & Hinglish)
 */
function parseDateFromText(text) {
  var now = new Date();
  var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // Relative tokens
  if (/\b(today|aaj)\b/i.test(text)) {
    return today;
  }
  if (/\b(tomorrow|kal|tmrw|tom)\b/i.test(text)) {
    return new Date(today.getTime() + 1 * 24 * 60 * 60 * 1000);
  }
  if (/\b(parso|day after tomorrow)\b/i.test(text)) {
    return new Date(today.getTime() + 2 * 24 * 60 * 60 * 1000);
  }
  if (/\b(tarso|day after parso)\b/i.test(text)) {
    return new Date(today.getTime() + 3 * 24 * 60 * 60 * 1000);
  }

  // Weekdays: monday/somwar, tuesday/mangalwar, etc.
  var daysMap = {
    'sun': 0, 'sunday': 0, 'itwar': 0, 'ravivar': 0,
    'mon': 1, 'monday': 1, 'som': 1, 'somwar': 1,
    'tue': 2, 'tuesday': 2, 'mangal': 2, 'mangalwar': 2,
    'wed': 3, 'wednesday': 3, 'budh': 3, 'budhwar': 3,
    'thu': 4, 'thursday': 4, 'guru': 4, 'guruwar': 4, 'veervar': 4,
    'fri': 5, 'friday': 5, 'shukra': 5, 'shukrawar': 5,
    'sat': 6, 'saturday': 6, 'shani': 6, 'shaniwar': 6
  };

  for (var key in daysMap) {
    var regex = new RegExp('\\b' + key + '\\b', 'i');
    if (regex.test(text)) {
      var targetDay = daysMap[key];
      var diff = targetDay - today.getDay();
      if (diff <= 0) diff += 7; // next upcoming day
      return new Date(today.getTime() + diff * 24 * 60 * 60 * 1000);
    }
  }

  // Explicit formats: DD-MMM (e.g. 28-Nov, 3 Dec, 28th Nov)
  var monthNames = {
    'jan': 0, 'feb': 1, 'mar': 2, 'apr': 3, 'may': 4, 'jun': 5,
    'jul': 6, 'aug': 7, 'sep': 8, 'oct': 9, 'nov': 10, 'dec': 11
  };

  var dMmmMatch = text.match(/(\d{1,2})(?:st|nd|rd|th)?[\s\-\/\.](jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i);
  if (!dMmmMatch) {
    dMmmMatch = text.match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[\s\-\/\.](\d{1,2})/i);
    if (dMmmMatch) {
      // swapped
      var mStr = dMmmMatch[1].toLowerCase().slice(0, 3);
      var dayNum = parseInt(dMmmMatch[2], 10);
      return new Date(now.getFullYear(), monthNames[mStr], dayNum);
    }
  } else {
    var dayNum = parseInt(dMmmMatch[1], 10);
    var mStr = dMmmMatch[2].toLowerCase().slice(0, 3);
    var targetYear = now.getFullYear();
    var parsedMonth = monthNames[mStr];
    // If date has passed by more than 2 months, assume next year
    if (parsedMonth < now.getMonth() - 2) {
      targetYear++;
    }
    return new Date(targetYear, parsedMonth, dayNum);
  }

  // DD/MM or DD-MM format
  var numDateMatch = text.match(/\b(\d{1,2})[\/\-\.](\d{1,2})(?:[\/\-\.](\d{2,4}))?\b/);
  if (numDateMatch) {
    var day = parseInt(numDateMatch[1], 10);
    var month = parseInt(numDateMatch[2], 10) - 1;
    var year = numDateMatch[3] ? parseInt(numDateMatch[3], 10) : now.getFullYear();
    if (year < 100) year += 2000;
    if (day >= 1 && day <= 31 && month >= 0 && month <= 11) {
      return new Date(year, month, day);
    }
  }

  // Standalone day number near destination (e.g. "Kolkata 28", "Haldia 15")
  var standAloneMatch = text.match(/\b(\d{1,2})(?:st|nd|rd|th)?\b/);
  if (standAloneMatch) {
    var dVal = parseInt(standAloneMatch[1], 10);
    if (dVal >= 1 && dVal <= 31) {
      var dMonth = now.getMonth();
      if (dVal < now.getDate()) dMonth++;
      return new Date(now.getFullYear(), dMonth, dVal);
    }
  }

  return null;
}

/**
 * Checks for status commands from assigned staff
 */
function parseStatusCommand(text) {
  var t = text.trim();

  // "Booked <train no> <date/time>"
  var bookedMatch = t.match(/^booked\s*(.*)$/i);
  if (bookedMatch) {
    return { action: 'BOOKED', details: bookedMatch[1] };
  }

  if (/^(departed|on train|train caught|nikal gaya|rawana)/i.test(t)) {
    return { action: 'DEPARTED' };
  }
  if (/^(reached|pahunch gaya|arrived)/i.test(t)) {
    return { action: 'REACHED' };
  }
  if (/^(delivered|paper diya|docs delivered|done)/i.test(t)) {
    return { action: 'DELIVERED' };
  }
  if (/^(returning|wapas|on return train)/i.test(t)) {
    return { action: 'RETURNING' };
  }
  if (/^(back|returned|office pahunch gaya)/i.test(t)) {
    return { action: 'RETURNED' };
  }
  if (/^(can'?t go|cannot go|nahi ja sakta|emergency cancel)/i.test(t)) {
    return { action: 'CANT_GO' };
  }

  return null;
}

/**
 * Handles status updates from staff for their latest active trip
 */
function handleStaffStatusUpdate(sender, cmd, rawText) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Trips');
  var data = sheet.getDataRange().getValues();

  // Find latest active trip assigned to this staff member
  var activeTripRow = -1;
  var tripId = '';
  var tripDest = '';

  for (var r = data.length - 1; r >= 1; r--) {
    var assigned = data[r][7];
    var status = data[r][10];
    if (assigned === sender.name && status !== 'Delivered' && status !== 'Returned' && status !== 'Cancelled') {
      activeTripRow = r + 1;
      tripId = data[r][0];
      tripDest = data[r][3];
      break;
    }
  }

  if (activeTripRow === -1) {
    return {
      status: 'NO_ACTIVE_TRIP',
      tripId: '',
      reply: "No active uncompleted trip found for " + sender.name + "."
    };
  }

  var nowStr = Utilities.formatDate(new Date(), "Asia/Kolkata", "yyyy-MM-dd HH:mm:ss");

  if (cmd.action === 'CANT_GO') {
    // Sets Needs reassignment, alerts coordinator, never blindly auto-reassigns
    sheet.getRange(activeTripRow, 11).setValue('Needs reassignment');
    sheet.getRange(activeTripRow, 28).setValue('Staff reported unable to travel: ' + rawText);
    sheet.getRange(activeTripRow, 29).setValue(nowStr);

    logAction(sender.name, 'CANT_GO', tripId, 'Staff reported inability to travel. Marked for coordinator review.');
    sendAlertToCoordinator('URGENT_REASSIGNMENT', tripId, sender.name, tripDest);

    return {
      status: 'NEEDS_REASSIGNMENT',
      tripId: tripId,
      reply: "Understood. Trip " + tripId + " marked as 'Needs reassignment'. Coordinator has been alerted."
    };
  }

  if (cmd.action === 'BOOKED') {
    sheet.getRange(activeTripRow, 23).setValue('Booked'); // TicketStatus
    var parsedTrain = parseTrainDetails(cmd.details);
    if (parsedTrain.trainNo) sheet.getRange(activeTripRow, 15).setValue(parsedTrain.trainNo);
    if (parsedTrain.depTime) sheet.getRange(activeTripRow, 17).setValue(parsedTrain.depTime);
    if (!parsedTrain.trainNo) {
      // If parsing train details wasn't clean, store in Notes
      var curNotes = sheet.getRange(activeTripRow, 28).getValue();
      sheet.getRange(activeTripRow, 28).setValue((curNotes ? curNotes + ' | ' : '') + 'Train info: ' + cmd.details);
    }
    sheet.getRange(activeTripRow, 29).setValue(nowStr);
    logAction(sender.name, 'TICKET_BOOKED', tripId, cmd.details);

    return {
      status: 'TICKET_UPDATED',
      tripId: tripId,
      reply: "Ticket details noted for " + tripId + ". Safe travels!"
    };
  }

  var statusMapping = {
    'DEPARTED': 'In Transit',
    'REACHED': 'Reached',
    'DELIVERED': 'Delivered',
    'RETURNING': 'In Transit',
    'RETURNED': 'Returned'
  };

  var newStatus = statusMapping[cmd.action];
  if (newStatus) {
    sheet.getRange(activeTripRow, 11).setValue(newStatus);
    sheet.getRange(activeTripRow, 29).setValue(nowStr);
    logAction(sender.name, 'STATUS_UPDATE', tripId, 'Updated status to ' + newStatus);

    return {
      status: 'STATUS_UPDATED',
      tripId: tripId,
      reply: "Status for " + tripId + " updated to '" + newStatus + "'. Thank you!"
    };
  }

  return {
    status: 'UNKNOWN_ACTION',
    tripId: tripId,
    reply: "Command received."
  };
}

/**
 * Parses train number and time from text (e.g. "12814 06:10", "12814 at 6:10 am")
 */
function parseTrainDetails(text) {
  var trainNo = '';
  var depTime = '';

  var tNoMatch = text.match(/\b\d{5}\b/);
  if (tNoMatch) trainNo = tNoMatch[0];

  var timeMatch = text.match(/\b(\d{1,2}):(\d{2})(?:\s*(am|pm))?\b/i);
  if (timeMatch) {
    var hours = parseInt(timeMatch[1], 10);
    var mins = timeMatch[2];
    var ampm = timeMatch[3];
    if (ampm) {
      if (ampm.toLowerCase() === 'pm' && hours < 12) hours += 12;
      if (ampm.toLowerCase() === 'am' && hours === 12) hours = 0;
    }
    depTime = String(hours).padStart(2, '0') + ':' + mins;
  }

  return { trainNo: trainNo, depTime: depTime };
}

/**
 * Creates trip record in Google Sheet from WhatsApp request
 */
function createTripFromWhatsApp(parsed, sender, isCoordinator) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Trips');

  var dateStr = Utilities.formatDate(parsed.date, "Asia/Kolkata", "yyyy-MM-dd");
  var yearMonth = Utilities.formatDate(parsed.date, "Asia/Kolkata", "yyyy-MM");
  var seq = String(sheet.getLastRow()).padStart(3, '0');
  var tripId = 'TRP-' + yearMonth + '-' + seq;

  var assignedStaff = '';
  var status = 'Pending approval';
  var assignMode = 'AUTO';

  if (isCoordinator) {
    var best = findEligibleStaffForTrip(parsed.date, parsed.date, parsed.destination, parsed.priority, false);
    if (best) {
      assignedStaff = best.name;
      status = 'Assigned';
    } else {
      status = 'Needs reassignment';
    }
  }

  var nowStr = Utilities.formatDate(new Date(), "Asia/Kolkata", "yyyy-MM-dd HH:mm:ss");

  var rowData = [
    tripId, 'Document delivery', parsed.docType, parsed.destination,
    dateStr, dateStr, parsed.priority, assignedStaff, assignMode, '', status,
    'Train', 'TATA', 'HWH', '', '', '', '', '', '', '', '',
    'Not booked', 'CC', 'WHATSAPP', sender.name, '', 'Created via WhatsApp', nowStr
  ];

  sheet.appendRow(rowData);
  logAction(sender.name, 'WHATSAPP_CREATE', tripId, 'Trip ' + tripId + ' created (' + status + ')');

  if (isCoordinator && assignedStaff) {
    // Notify the assigned person
    notifyStaffOfAssignment(tripId, assignedStaff, parsed.destination, dateStr);

    return {
      status: 'ASSIGNED',
      tripId: tripId,
      reply: "Trip " + tripId + " created! Assigned to: " + assignedStaff + " for " + parsed.destination + " on " + dateStr + "."
    };
  } else if (!isCoordinator) {
    // Alert coordinator of pending approval
    sendAlertToCoordinator('PENDING_APPROVAL', tripId, sender.name, parsed.destination + ' on ' + dateStr);

    return {
      status: 'PENDING_APPROVAL',
      tripId: tripId,
      reply: "Trip request " + tripId + " received for " + parsed.destination + " on " + dateStr + ". Submitted for Coordinator approval."
    };
  } else {
    return {
      status: 'NEEDS_REASSIGNMENT',
      tripId: tripId,
      reply: "Trip " + tripId + " created for " + parsed.destination + " on " + dateStr + ", but NO eligible staff was available. Marked for manual review."
    };
  }
}

/**
 * Returns active trip summary for querying staff
 */
function getStaffTripSummary(staffName) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Trips');
  var data = sheet.getDataRange().getValues();

  var trips = [];
  for (var i = 1; i < data.length; i++) {
    if (data[i][7] === staffName && data[i][10] !== 'Cancelled' && data[i][10] !== 'Returned') {
      trips.push("• " + data[i][0] + " to " + data[i][3] + " on " + formatDateForClient(data[i][4]) + " (" + data[i][10] + ")");
    }
  }

  if (trips.length === 0) {
    return staffName + ", you have no upcoming active trips assigned.";
  }
  return "Upcoming trips for " + staffName + ":\n" + trips.join("\n");
}

/**
 * Appends record to Inbox audit sheet
 */
function logInbox(inboxSheet, timestamp, phone, messageId, rawText, intent, dest, date, result, tripId) {
  try {
    inboxSheet.appendRow([
      timestamp, phone, messageId, rawText, intent, dest, date, result, tripId
    ]);
  } catch (e) {
    console.error("Inbox log error: " + e.toString());
  }
}
