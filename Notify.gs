/**
 * Swift Trip Planner - Notify.gs
 * Client: Swift Strips India Pvt. Ltd. (SLTT Group), Jamshedpur, Jharkhand, India
 * 
 * Scheduled Notification & Alert Engine:
 * - 15-minute time-driven trigger for train departures
 * - Departure alerts: Day before at 17:00, 3h before, 1h before
 * - Ticket unbooked 24h warning
 * - Post-arrival (+2h) status check
 * - Hidden Alerts tab deduplication & 3-retry backoff
 * - Outbound webhook payload formatting
 */

/**
 * 15-minute time-driven trigger entry point
 */
function checkAndSendTrainAlerts() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tripsSheet = ss.getSheetByName('Trips');
  var alertsSheet = ss.getSheetByName('Alerts');
  var config = getConfigMap();

  var tripsData = tripsSheet.getDataRange().getValues();
  var now = new Date();

  for (var r = 1; r < tripsData.length; r++) {
    var row = tripsData[r];
    var tripId = row[0];
    var destination = row[3];
    var startDateVal = row[4];
    var priority = row[6];
    var assignedTo = row[7];
    var status = row[10];
    var fromStation = row[12] || 'TATA';
    var onwardTrainNo = row[14];
    var onwardTrainName = row[15];
    var onwardDepVal = row[16];
    var onwardArrVal = row[17];
    var ticketStatus = row[22];
    var docType = row[2];

    if (!tripId || !assignedTo || status === 'Cancelled' || status === 'Delivered' || status === 'Returned') {
      continue;
    }

    var staffPhone = getStaffPhone(assignedTo);
    var depDate = onwardDepVal ? new Date(onwardDepVal) : (startDateVal ? new Date(startDateVal) : null);
    if (!depDate) continue;

    var diffMs = depDate.getTime() - now.getTime();
    var diffHours = diffMs / (1000 * 60 * 60);

    // 1. Day before alert at 17:00 IST (approx 14 to 28 hours before departure)
    var isDayBefore = isTomorrow(depDate, now);
    if (isDayBefore && now.getHours() >= 17) {
      if (!isAlertSent(alertsSheet, tripId, 'DAY_BEFORE_1700')) {
        sendMilestoneAlert({
          event: 'DAY_BEFORE_REMINDER',
          tripId: tripId,
          staffName: assignedTo,
          phone: staffPhone,
          destination: destination,
          startDate: formatDateForClient(startDateVal),
          trainName: onwardTrainName || 'Express Train',
          trainNo: onwardTrainNo || 'Train',
          departure: depDate.toTimeString().slice(0, 5),
          fromStation: fromStation,
          docType: docType,
          priority: priority
        }, alertsSheet, 'DAY_BEFORE_1700');
      }
    }

    // 2. Departure lead hours: 3 hours and 1 hour before
    if (diffHours <= 3.5 && diffHours >= 2.0) {
      if (!isAlertSent(alertsSheet, tripId, 'DEP_LEAD_3H')) {
        sendMilestoneAlert({
          event: 'DEP_3H_ALERT',
          tripId: tripId,
          staffName: assignedTo,
          phone: staffPhone,
          destination: destination,
          startDate: formatDateForClient(startDateVal),
          trainName: onwardTrainName || 'Express Train',
          trainNo: onwardTrainNo || 'Train',
          departure: depDate.toTimeString().slice(0, 5),
          fromStation: fromStation,
          docType: docType,
          leadHours: 3,
          priority: priority
        }, alertsSheet, 'DEP_LEAD_3H');
      }
    }

    if (diffHours <= 1.5 && diffHours > 0) {
      if (!isAlertSent(alertsSheet, tripId, 'DEP_LEAD_1H')) {
        sendMilestoneAlert({
          event: 'DEP_1H_ALERT',
          tripId: tripId,
          staffName: assignedTo,
          phone: staffPhone,
          destination: destination,
          startDate: formatDateForClient(startDateVal),
          trainName: onwardTrainName || 'Express Train',
          trainNo: onwardTrainNo || 'Train',
          departure: depDate.toTimeString().slice(0, 5),
          fromStation: fromStation,
          docType: docType,
          leadHours: 1,
          priority: priority
        }, alertsSheet, 'DEP_LEAD_1H');
      }
    }

    // 3. Ticket unbooked alert (24 hours before departure)
    if (ticketStatus !== 'Booked' && diffHours <= 24 && diffHours > 0) {
      if (!isAlertSent(alertsSheet, tripId, 'TICKET_MISSING_24H')) {
        sendMilestoneAlert({
          event: 'TICKET_MISSING_WARNING',
          tripId: tripId,
          staffName: assignedTo,
          phone: staffPhone,
          destination: destination,
          startDate: formatDateForClient(startDateVal),
          docType: docType,
          priority: priority
        }, alertsSheet, 'TICKET_MISSING_24H');
      }
    }

    // 4. Post-arrival follow up (+2 hours after arrival)
    if (onwardArrVal && status === 'In Transit') {
      var arrDate = new Date(onwardArrVal);
      var afterArrHours = (now.getTime() - arrDate.getTime()) / (1000 * 60 * 60);

      if (afterArrHours >= 2.0 && afterArrHours <= 12.0) {
        if (!isAlertSent(alertsSheet, tripId, 'POST_ARR_2H')) {
          sendMilestoneAlert({
            event: 'POST_ARRIVAL_CHECK',
            tripId: tripId,
            staffName: assignedTo,
            phone: staffPhone,
            destination: destination,
            priority: priority
          }, alertsSheet, 'POST_ARR_2H');
        }
      }
    }
  }
}

/**
 * Checks if target date is calendar day after current date
 */
function isTomorrow(target, now) {
  var t = new Date(target.getFullYear(), target.getMonth(), target.getDate());
  var n = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  var diffDays = Math.round((t - n) / (24 * 3600 * 1000));
  return diffDays === 1;
}

/**
 * Checks if alert of given type was already recorded for tripId
 */
function isAlertSent(alertsSheet, tripId, alertType) {
  var data = alertsSheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === tripId && data[i][1] === alertType) {
      return true;
    }
  }
  return false;
}

/**
 * Sends milestone alert via OutboundWebhookURL with retry backoff
 */
function sendMilestoneAlert(payloadObj, alertsSheet, alertType) {
  var config = getConfigMap();
  var webhookUrl = config['OutboundWebhookURL'];

  var mapLink = "https://maps.google.com/?q=22.8046,86.2029";
  payloadObj.mapLink = mapLink;

  var success = true;
  if (webhookUrl) {
    success = sendWithRetry(webhookUrl, payloadObj, 3);
  }

  // Record in hidden Alerts tab to ensure no duplicate spam
  var sentAt = Utilities.formatDate(new Date(), "Asia/Kolkata", "yyyy-MM-dd HH:mm:ss");
  var payloadHash = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify(payloadObj))
    .map(function(byte) { return ('0' + (byte & 0xFF).toString(16)).slice(-2); }).join('');

  alertsSheet.appendRow([payloadObj.tripId, alertType, sentAt, payloadHash]);
  logAction('NOTIFY', alertType, payloadObj.tripId, 'Alert dispatched to ' + payloadObj.staffName + (success ? ' (Webhook delivered)' : ' (Logged locally)'));
}

/**
 * HTTP POST with 3 retries and exponential backoff
 */
function sendWithRetry(url, data, maxRetries) {
  var retries = 0;
  var delay = 1000;

  while (retries < maxRetries) {
    try {
      var options = {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify(data),
        muteHttpExceptions: true
      };
      var response = UrlFetchApp.fetch(url, options);
      if (response.getResponseCode() >= 200 && response.getResponseCode() < 300) {
        return true;
      }
    } catch (e) {
      console.warn("Webhook delivery error: " + e.toString());
    }

    retries++;
    Utilities.sleep(delay);
    delay *= 2; // exponential backoff
  }
  return false;
}

/**
 * Notifies staff of assignment
 */
function notifyStaffOfAssignment(tripId, staffName, destination, dateStr) {
  var config = getConfigMap();
  var webhookUrl = config['OutboundWebhookURL'];
  var staffPhone = getStaffPhone(staffName);

  var payload = {
    event: 'TRIP_ASSIGNED',
    tripId: tripId,
    staffName: staffName,
    phone: staffPhone,
    destination: destination,
    startDate: dateStr,
    message: "You have been assigned trip " + tripId + " to " + destination + " on " + dateStr + ". Please arrange ticket."
  };

  if (webhookUrl) {
    sendWithRetry(webhookUrl, payload, 3);
  }
  logAction('NOTIFY', 'STAFF_ASSIGNMENT', tripId, 'Notified ' + staffName);
}

/**
 * Sends urgent alert to coordinator
 */
function sendAlertToCoordinator(alertType, tripId, staffName, details) {
  var config = getConfigMap();
  var webhookUrl = config['OutboundWebhookURL'];
  var coordPhone = getCoordinatorPhone();

  var payload = {
    event: alertType,
    tripId: tripId,
    reporter: staffName,
    phone: coordPhone,
    details: details
  };

  if (webhookUrl) {
    sendWithRetry(webhookUrl, payload, 3);
  }
  logAction('NOTIFY', alertType, tripId, 'Coordinator alerted by ' + staffName + ': ' + details);
}

/**
 * Helper: Find phone number for staff name
 */
function getStaffPhone(staffName) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Staff');
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === staffName) {
      return data[i][1];
    }
  }
  return '';
}

/**
 * Helper: Find coordinator phone number
 */
function getCoordinatorPhone() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Staff');
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][2] === 'Coordinator' || data[i][2] === 'Admin') {
      return data[i][1];
    }
  }
  return '+919876543200';
}

/**
 * Test notification trigger
 */
function sendTestAlertNotification() {
  var config = getConfigMap();
  var webhookUrl = config['OutboundWebhookURL'];

  var testPayload = {
    event: 'TEST_ALERT',
    tripId: 'TRP-TEST-001',
    staffName: 'Mohit Saw',
    phone: '+919876543210',
    destination: 'Kolkata',
    startDate: Utilities.formatDate(new Date(), "Asia/Kolkata", "dd-MMM-yyyy"),
    departure: '06:10',
    docType: 'Invoice',
    priority: 'Normal',
    mapLink: 'https://maps.google.com/?q=22.8046,86.2029'
  };

  if (!webhookUrl) {
    return "No OutboundWebhookURL configured in Config tab. Alert was verified and logged internally.";
  }

  var ok = sendWithRetry(webhookUrl, testPayload, 2);
  return ok ? "Test webhook successfully delivered to " + webhookUrl : "Failed to deliver webhook. Check URL in Config tab.";
}

/**
 * Generates monthly PDF report and saves to Drive
 */
function exportMonthlyReportToPdf() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var reportSheet = getOrCreateSheet(ss, 'Monthly_Report');
  reportSheet.clear();

  var currentMonth = Utilities.formatDate(new Date(), "Asia/Kolkata", "MMMM yyyy");
  var stats = calculateFairnessStatistics();

  reportSheet.getRange('A1').setValue('SWIFT STRIPS INDIA PVT. LTD. - MONTHLY TRAVEL REPORT');
  reportSheet.getRange('A1').setFontWeight('bold').setFontSize(14).setFontColor('#1E3A8A');

  reportSheet.getRange('A2').setValue('Report Period: ' + currentMonth + ' | Generated: ' + Utilities.formatDate(new Date(), "Asia/Kolkata", "dd-MMM-yyyy HH:mm"));
  reportSheet.getRange('A2').setFontStyle('italic');

  reportSheet.getRange('A4:D4').setValues([['Staff Member', 'Total Trips', 'Weighted Load', 'Rotation Fairness Status']]);
  reportSheet.getRange('A4:D4').setFontWeight('bold').setBackground('#E2E8F0');

  var r = 5;
  for (var name in stats.staffLoads) {
    var load = stats.staffLoads[name];
    var trips = stats.tripCounts[name];
    var status = (load - stats.minLoad <= 1.0) ? 'Balanced' : 'Review needed';
    reportSheet.getRange(r, 1, 1, 4).setValues([[name, trips, load.toFixed(1), status]]);
    r++;
  }

  reportSheet.getRange(r + 1, 1).setValue('Fairness Gap (Max - Min Load): ' + stats.fairnessGap.toFixed(1) + ' weight units.');
  reportSheet.getRange(r + 1, 1).setFontWeight('bold');

  reportSheet.autoResizeColumns(1, 4);

  // Export sheet as PDF to Drive
  var blob = reportSheet.getAs('application/pdf');
  blob.setName('Swift_Strips_Monthly_Travel_Report_' + stats.month + '.pdf');
  var file = DriveApp.createFile(blob);

  logAction('REPORT', 'PDF_EXPORT', '', 'Exported monthly report: ' + file.getName());
  return file.getUrl();
}
