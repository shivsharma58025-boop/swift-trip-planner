/**
 * Swift Trip Planner - Code.gs
 * Client: Swift Strips India Pvt. Ltd. (SLTT Group), Jamshedpur, Jharkhand, India
 * 
 * Main Web Server endpoints (doGet, doPost), routing, public data sanitization,
 * and custom menu handlers.
 */

/**
 * Web App Entry point: Serves Index.html
 * Enforces ?key=ViewKey access protection.
 */
function doGet(e) {
  var key = (e && e.parameter && e.parameter.key) ? e.parameter.key : '';
  var config = getConfigMap();
  var expectedKey = config['ViewKey'] || 'swift-view-2026';

  if (key !== expectedKey) {
    return HtmlService.createHtmlOutput(
      "<div style='font-family:sans-serif;padding:40px;text-align:center;color:#b91c1c;'>" +
      "<h2>Access Denied</h2><p>Invalid or missing security key. Please use the authorized URL link (?key=...).</p>" +
      "</div>"
    ).setTitle("Access Denied - Swift Trip Planner");
  }

  var template = HtmlService.createTemplateFromFile('Index');
  template.viewKey = key;
  return template.evaluate()
    .setTitle("Swift Trip Planner | Swift Strips India")
    .addMetaTag("viewport", "width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Webhook Entry point: Handles inbound WhatsApp payloads from n8n
 */
function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (err) {
    return createJsonResponse({ status: 'error', message: 'Server busy. Try again.' }, 429);
  }

  try {
    var rawPost = (e && e.postData && e.postData.contents) ? e.postData.contents : '';
    if (!rawPost) {
      return createJsonResponse({ status: 'error', message: 'No payload provided' }, 400);
    }

    var payload = JSON.parse(rawPost);

    // 1. Verify Shared Secret
    var scriptProps = PropertiesService.getScriptProperties();
    var expectedSecret = scriptProps.getProperty('WHATSAPP_SHARED_SECRET');
    var providedSecret = payload.secret || (e.parameter && e.parameter.secret);

    // If a secret is set in script properties, enforce it
    if (expectedSecret && providedSecret !== expectedSecret) {
      return createJsonResponse({ status: 'error', message: 'Unauthorized secret' }, 401);
    }

    // 2. Validate input schema
    var phone = payload.phone ? String(payload.phone).trim() : '';
    var text = payload.text ? String(payload.text).trim() : '';
    var messageId = payload.messageId ? String(payload.messageId).trim() : '';
    var timestamp = payload.timestamp || new Date().toISOString();

    if (!phone || !text || !messageId) {
      return createJsonResponse({ status: 'error', message: 'Missing phone, text, or messageId' }, 400);
    }

    // 3. Process WhatsApp message through Parser gateway
    var responseData = processInboundWhatsAppMessage(phone, text, messageId, timestamp);
    return createJsonResponse(responseData, 200);

  } catch (error) {
    logAction('SYSTEM', 'POST_ERROR', '', error.toString());
    return createJsonResponse({ status: 'error', message: error.toString() }, 500);
  } finally {
    lock.releaseLock();
  }
}

/**
 * Helper to produce JSON responses with clean headers
 */
function createJsonResponse(data, statusCode) {
  var output = ContentService.createTextOutput(JSON.stringify(data));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}

/**
 * Client-callable function: getPublicData()
 * Loads sanitized trip records, stations, staff metadata, and config for UI.
 * NEVER returns Phone numbers or PNR.
 */
function getPublicData() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var config = getConfigMap();

  // 1. Staff Map (Sanitized: NO phone numbers)
  var staffSheet = ss.getSheetByName('Staff');
  var staffData = staffSheet.getDataRange().getValues();
  var staffList = [];
  var staffMap = {};

  for (var i = 1; i < staffData.length; i++) {
    var name = staffData[i][0];
    var role = staffData[i][2];
    var active = staffData[i][3];
    var colour = staffData[i][4] || '#3B82F6';
    if (name) {
      var staffObj = { name: name, role: role, active: active, colour: colour };
      staffList.push(staffObj);
      staffMap[name] = staffObj;
    }
  }

  // 2. Destinations
  var destSheet = ss.getSheetByName('Destinations');
  var destData = destSheet.getDataRange().getValues();
  var destinations = [];
  for (var d = 1; d < destData.length; d++) {
    if (destData[d][0]) {
      destinations.push({
        name: destData[d][0],
        lat: Number(destData[d][1]),
        lng: Number(destData[d][2]),
        roadKm: Number(destData[d][3]),
        weight: Number(destData[d][4]),
        notes: destData[d][5]
      });
    }
  }

  // 3. Stations
  var stnSheet = ss.getSheetByName('Stations');
  var stnData = stnSheet.getDataRange().getValues();
  var stations = [];
  for (var s = 1; s < stnData.length; s++) {
    if (stnData[s][0]) {
      stations.push({
        code: stnData[s][0],
        name: stnData[s][1],
        city: stnData[s][2],
        lat: Number(stnData[s][3]),
        lng: Number(stnData[s][4])
      });
    }
  }

  // 4. Trips (Sanitized: strictly omit PNR and internal indices)
  var tripsSheet = ss.getSheetByName('Trips');
  var tripsData = tripsSheet.getDataRange().getValues();
  var trips = [];

  for (var t = 1; t < tripsData.length; t++) {
    var row = tripsData[t];
    var tripId = row[0];
    if (!tripId) continue;

    var assignedTo = row[7] || '';
    var staffColour = (staffMap[assignedTo] && staffMap[assignedTo].colour) ? staffMap[assignedTo].colour : '#64748B';

    trips.push({
      tripId: tripId,
      purpose: row[1] || '',
      docType: row[2] || '',
      destination: row[3] || '',
      startDate: formatDateForClient(row[4]),
      endDate: formatDateForClient(row[5] || row[4]),
      priority: row[6] || 'Normal',
      assignedTo: assignedTo,
      staffColour: staffColour,
      assignMode: row[8] || 'AUTO',
      overrideReason: row[9] || '',
      status: row[10] || 'Planned',
      travelMode: row[11] || 'Train',
      fromStation: row[12] || 'TATA',
      toStation: row[13] || '',
      onwardTrainNo: row[14] || '',
      onwardTrainName: row[15] || '',
      onwardDepDateTime: formatDateTimeForClient(row[16]),
      onwardArrDateTime: formatDateTimeForClient(row[17]),
      returnTrainNo: row[18] || '',
      returnTrainName: row[19] || '',
      returnDepDateTime: formatDateTimeForClient(row[20]),
      returnArrDateTime: formatDateTimeForClient(row[21]),
      ticketStatus: row[22] || 'Not booked',
      travelClass: row[23] || 'CC',
      source: row[24] || 'SHEET',
      notes: row[27] || '',
      lastUpdated: formatDateTimeForClient(row[28])
      // Notice: PNR (row[26]) and Phone numbers are strictly NOT included here!
    });
  }

  // Next in rotation prediction
  var nextInRotation = predictNextRotationStaff();

  return {
    trips: trips,
    destinations: destinations,
    stations: stations,
    staff: staffList,
    nextInRotation: nextInRotation,
    baseCoords: { lat: 22.8046, lng: 86.2029, name: "Swift Strips Plant, Jamshedpur" },
    mapboxToken: config['MapboxToken'] || '',
    workingDays: config['WorkingDays'] || 'Mon,Tue,Wed,Thu,Fri,Sat',
    timestamp: new Date().toISOString()
  };
}

/**
 * Format helpers for client data
 */
function formatDateForClient(val) {
  if (!val) return '';
  if (val instanceof Date) {
    return Utilities.formatDate(val, "Asia/Kolkata", "dd-MMM-yyyy");
  }
  return String(val);
}

function formatDateTimeForClient(val) {
  if (!val) return '';
  if (val instanceof Date) {
    return Utilities.formatDate(val, "Asia/Kolkata", "yyyy-MM-dd'T'HH:mm:ss");
  }
  return String(val);
}

/**
 * Helper: Read Config tab into Key-Value map
 */
function getConfigMap() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Config');
  if (!sheet) return {};
  var data = sheet.getDataRange().getValues();
  var map = {};
  for (var i = 1; i < data.length; i++) {
    if (data[i][0]) {
      map[String(data[i][0]).trim()] = String(data[i][1]).trim();
    }
  }
  return map;
}

/**
 * Helper: Sanitise user inputs to prevent formula injection (=, +, -, @)
 */
function sanitizeInput(str) {
  if (!str) return '';
  var s = String(str).trim();
  if (/^[=\+\-@]/.test(s)) {
    return "'" + s;
  }
  return s;
}

/**
 * Helper: Log action to Log tab
 */
function logAction(actor, action, tripId, details) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('Log');
    if (!sheet) return;
    var timestamp = Utilities.formatDate(new Date(), "Asia/Kolkata", "yyyy-MM-dd HH:mm:ss");
    sheet.appendRow([timestamp, actor, action, tripId, details]);
  } catch (e) {
    console.error("Failed to append log: " + e.toString());
  }
}

/**
 * Custom Menu Action: Assign pending trips
 */
function menuAssignPendingTrips() {
  var count = assignAllPendingTrips();
  SpreadsheetApp.getUi().alert("Finished checking trips. Assigned " + count + " pending trips.");
}

/**
 * Custom Menu Action: Preview next 30 days
 */
function menuPreviewNext30Days() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var previewSheet = getOrCreateSheet(ss, 'Preview');
  previewSheet.clear();

  var headers = ['SimDate', 'Destination', 'ProjectedStaff', 'WeightedLoadBefore', 'Notes'];
  previewSheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  previewSheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#E2E8F0');

  var today = new Date();
  var rows = [];
  var destSheet = ss.getSheetByName('Destinations');
  var dests = destSheet.getRange('A2:A5').getValues().map(function(r) { return r[0]; }).filter(Boolean);
  if (dests.length === 0) dests = ['Kolkata', 'Haldia', 'Kolkata Port'];

  for (var i = 1; i <= 30; i++) {
    var date = new Date(today.getTime() + i * 24 * 60 * 60 * 1000);
    var dayName = Utilities.formatDate(date, "Asia/Kolkata", "EEE");
    if (dayName === 'Sun') continue; // skip non-working day

    var dest = dests[i % dests.length];
    var projected = findEligibleStaffForTrip(date, date, dest, 'Normal', false);
    rows.push([
      Utilities.formatDate(date, "Asia/Kolkata", "dd-MMM-yyyy"),
      dest,
      projected ? projected.name : 'NO ELIGIBLE STAFF',
      projected ? projected.load : 0,
      'Projected round-robin turn'
    ]);
  }

  if (rows.length > 0) {
    previewSheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
    previewSheet.autoResizeColumns(1, headers.length);
  }
  SpreadsheetApp.getUi().alert("Generated 30-day projection in the 'Preview' tab.");
}

/**
 * Custom Menu Action: Generate monthly trips
 */
function menuGenerateMonthlyTrips() {
  var ui = SpreadsheetApp.getUi();
  var destPrompt = ui.prompt("Generate Monthly Trips", "Enter Destination (e.g. Kolkata, Haldia, Kolkata Port):", ui.ButtonSet.OK_CANCEL);
  if (destPrompt.getSelectedButton() !== ui.Button.OK) return;
  var dest = destPrompt.getResponseText().trim();

  var countPrompt = ui.prompt("Generate Monthly Trips", "How many trips to generate (e.g. 15):", ui.ButtonSet.OK_CANCEL);
  if (countPrompt.getSelectedButton() !== ui.Button.OK) return;
  var count = parseInt(countPrompt.getResponseText().trim(), 10);
  if (isNaN(count) || count <= 0) {
    ui.alert("Invalid count entered.");
    return;
  }

  var createdCount = batchCreateMonthlyTrips(dest, count);
  ui.alert("Successfully created and auto-assigned " + createdCount + " trips for " + dest + ".");
}

/**
 * Custom Menu Action: Send test notification
 */
function menuSendTestNotification() {
  var result = sendTestAlertNotification();
  SpreadsheetApp.getUi().alert("Test Notification Result: " + result);
}

/**
 * Custom Menu Action: Export monthly report (PDF to Drive)
 */
function menuExportMonthlyReport() {
  var fileUrl = exportMonthlyReportToPdf();
  SpreadsheetApp.getUi().alert("Report exported successfully!\n\nAccess file at:\n" + fileUrl);
}

/**
 * Custom Menu Action: Rebuild fairness numbers
 */
function menuRebuildFairnessNumbers() {
  var stats = calculateFairnessStatistics();
  var msg = "Fairness Summary for Current Month:\n\n";
  for (var staff in stats.staffLoads) {
    msg += "• " + staff + ": " + stats.staffLoads[staff].toFixed(1) + " weighted load (" + stats.tripCounts[staff] + " trips)\n";
  }
  msg += "\nFairness Gap (Max - Min): " + stats.fairnessGap.toFixed(1) + " points.";
  SpreadsheetApp.getUi().alert(msg);
}
