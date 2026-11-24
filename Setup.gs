/**
 * Swift Trip Planner - Setup.gs
 * Client: Swift Strips India Pvt. Ltd. (SLTT Group), Jamshedpur, Jharkhand, India
 * 
 * Creates and formats all sheets, headers, data validations, dropdowns,
 * conditional formatting rules, seed data, and custom menus.
 */

function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    throw new Error("No active spreadsheet found. Run this from within Google Sheets.");
  }

  // 1. Setup Tabs
  setupTripsTab(ss);
  setupStaffTab(ss);
  setupDestinationsTab(ss);
  setupStationsTab(ss);
  setupLeaveTab(ss);
  setupConfigTab(ss);
  setupInboxTab(ss);
  setupAlertsTab(ss);
  setupLogTab(ss);

  // 2. Setup Triggers
  setupInstallableTriggers();

  SpreadsheetApp.getUi().alert("Swift Trip Planner Setup Complete! Refresh the sheet or reload to see the custom 'Trip Planner' menu.");
}

/**
 * Creates custom menu on open
 */
function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('Trip Planner')
    .addItem('Assign pending trips', 'menuAssignPendingTrips')
    .addItem('Preview next 30 days', 'menuPreviewNext30Days')
    .addItem('Generate monthly trips', 'menuGenerateMonthlyTrips')
    .addItem('Send test notification', 'menuSendTestNotification')
    .addItem('Export monthly report (PDF to Drive)', 'menuExportMonthlyReport')
    .addItem('Rebuild fairness numbers', 'menuRebuildFairnessNumbers')
    .addToUi();
}

/**
 * Creates or gets existing sheet
 */
function getOrCreateSheet(ss, name) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  return sheet;
}

/**
 * Setup Trips Tab
 */
function setupTripsTab(ss) {
  var sheet = getOrCreateSheet(ss, 'Trips');
  sheet.clear();

  var headers = [
    'TripID', 'Purpose', 'DocType', 'Destination', 'StartDate', 'EndDate',
    'Priority', 'AssignedTo', 'AssignMode', 'OverrideReason', 'Status',
    'TravelMode', 'FromStation', 'ToStation', 'OnwardTrainNo', 'OnwardTrainName',
    'OnwardDepDateTime', 'OnwardArrDateTime', 'ReturnTrainNo', 'ReturnTrainName',
    'ReturnDepDateTime', 'ReturnArrDateTime', 'TicketStatus', 'Class',
    'Source', 'RequestedBy', 'PNR', 'Notes', 'LastUpdated'
  ];

  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  var headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setFontWeight('bold');
  headerRange.setBackground('#1A365D');
  headerRange.setFontColor('#FFFFFF');
  sheet.setFrozenRows(1);

  // Validations & Dropdowns
  var maxRows = 500;
  
  // DocType (Invoice/LC/Customs/Bank/Other) - Col 3
  var docTypeRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['Invoice', 'LC', 'Customs', 'Bank', 'Other'], true).build();
  sheet.getRange(2, 3, maxRows, 1).setDataValidation(docTypeRule);

  // Destination (From Destinations tab) - Col 4
  var destSheet = getOrCreateSheet(ss, 'Destinations');
  var destRule = SpreadsheetApp.newDataValidation()
    .requireValueInRange(destSheet.getRange('A2:A20'), true).build();
  sheet.getRange(2, 4, maxRows, 1).setDataValidation(destRule);

  // Priority (Normal/Urgent) - Col 7
  var priorityRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['Normal', 'Urgent'], true).build();
  sheet.getRange(2, 7, maxRows, 1).setDataValidation(priorityRule);

  // AssignedTo (From Staff tab) - Col 8
  var staffSheet = getOrCreateSheet(ss, 'Staff');
  var staffRule = SpreadsheetApp.newDataValidation()
    .requireValueInRange(staffSheet.getRange('A2:A20'), true).build();
  sheet.getRange(2, 8, maxRows, 1).setDataValidation(staffRule);

  // AssignMode (AUTO/MANUAL) - Col 9
  var assignModeRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['AUTO', 'MANUAL'], true).build();
  sheet.getRange(2, 9, maxRows, 1).setDataValidation(assignModeRule);

  // Status - Col 11
  var statusRule = SpreadsheetApp.newDataValidation()
    .requireValueInList([
      'Pending approval', 'Planned', 'Assigned', 'In Transit',
      'Reached', 'Delivered', 'Returned', 'Cancelled', 'Needs reassignment'
    ], true).build();
  sheet.getRange(2, 11, maxRows, 1).setDataValidation(statusRule);

  // TravelMode (Train/Road/Other) - Col 12
  var modeRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['Train', 'Road', 'Other'], true).build();
  sheet.getRange(2, 12, maxRows, 1).setDataValidation(modeRule);

  // TicketStatus - Col 23
  var ticketRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['Not booked', 'Booked', 'Waitlisted', 'RAC', 'Cancelled'], true).build();
  sheet.getRange(2, 23, maxRows, 1).setDataValidation(ticketRule);

  // Class - Col 24
  var classRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['SL', '3A', '2A', 'CC', '2S'], true).build();
  sheet.getRange(2, 24, maxRows, 1).setDataValidation(classRule);

  // Source - Col 25
  var sourceRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['SHEET', 'WHATSAPP'], true).build();
  sheet.getRange(2, 25, maxRows, 1).setDataValidation(sourceRule);

  // Conditional Formatting
  setupTripsConditionalFormatting(sheet);

  // Auto-resize
  for (var c = 1; c <= headers.length; c++) {
    sheet.setColumnWidth(c, 130);
  }
}

/**
 * Conditional formatting for Trips
 */
function setupTripsConditionalFormatting(sheet) {
  var range = sheet.getRange('A2:AC500');
  var rules = [];

  // Urgent = Orange ($G2="Urgent")
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=$G2="Urgent"')
    .setBackground('#FFEDD5')
    .setFontColor('#9A3412')
    .setRanges([range])
    .build());

  // Unassigned / Needs reassignment = Red ($H2="" or $K2="Needs reassignment")
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('OR(ISBLANK($H2), $K2="Needs reassignment")')
    .setBackground('#FEE2E2')
    .setFontColor('#991B1B')
    .setRanges([range])
    .build());

  // Delivered / Returned = Green ($K2="Delivered", "Returned")
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('OR($K2="Delivered", $K2="Returned")')
    .setBackground('#DCFCE7')
    .setFontColor('#166534')
    .setRanges([range])
    .build());

  // Cancelled = Grey ($K2="Cancelled")
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=$K2="Cancelled"')
    .setBackground('#F3F4F6')
    .setFontColor('#6B7280')
    .setRanges([range])
    .build());

  // Today's trips highlighted ($E2=TODAY())
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=$E2=TODAY()')
    .setBackground('#EFF6FF')
    .setFontColor('#1E40AF')
    .setRanges([range])
    .build());

  // Ticket not booked within 24h = Amber (StartDate is today or tomorrow and TicketStatus="Not booked")
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('AND($W2="Not booked", $E2<=TODAY()+1, $E2>=TODAY(), $K2<>"Cancelled")')
    .setBackground('#FEF3C7')
    .setFontColor('#92400E')
    .setRanges([range])
    .build());

  sheet.setConditionalFormatRules(rules);
}

/**
 * Setup Staff Tab
 */
function setupStaffTab(ss) {
  var sheet = getOrCreateSheet(ss, 'Staff');
  sheet.clear();

  var headers = ['Name', 'Phone', 'Role', 'Active', 'Colour', 'JoinedDate'];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  var headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setFontWeight('bold');
  headerRange.setBackground('#1A365D');
  headerRange.setFontColor('#FFFFFF');
  sheet.setFrozenRows(1);

  // Role validation
  var roleRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['Admin', 'Coordinator', 'Staff'], true).build();
  sheet.getRange('C2:C50').setDataValidation(roleRule);

  // Active Checkbox
  var checkboxRule = SpreadsheetApp.newDataValidation().requireCheckbox().build();
  sheet.getRange('D2:D50').setDataValidation(checkboxRule);

  // Seed Staff Data
  var seedData = [
    ['Mohit Saw', '+919876543210', 'Staff', true, '#2563EB', '2024-01-01'],
    ['Dablu Pandit', '+919876543211', 'Staff', true, '#059669', '2024-01-01'],
    ['Suraj Kumar', '+919876543212', 'Staff', true, '#D97706', '2024-01-01'],
    ['Abhinas', '+919876543213', 'Staff', true, '#7C3AED', '2024-01-01'],
    ['Satyam (Lead)', '+919876543200', 'Coordinator', true, '#DC2626', '2023-01-01']
  ];
  sheet.getRange(2, 1, seedData.length, seedData[0].length).setValues(seedData);

  sheet.autoResizeColumns(1, headers.length);
}

/**
 * Setup Destinations Tab
 */
function setupDestinationsTab(ss) {
  var sheet = getOrCreateSheet(ss, 'Destinations');
  sheet.clear();

  var headers = ['Name', 'Lat', 'Lng', 'RoadKm', 'Weight', 'Notes'];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  var headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setFontWeight('bold');
  headerRange.setBackground('#1A365D');
  headerRange.setFontColor('#FFFFFF');
  sheet.setFrozenRows(1);

  // Seed Destinations
  var seedDestinations = [
    ['Kolkata', 22.5726, 88.3639, 250, 1.0, 'verify coordinates on the map'],
    ['Haldia', 22.0667, 88.0698, 260, 1.2, 'verify coordinates on the map'],
    ['Kolkata Port', 22.5458, 88.3224, 255, 1.3, 'verify coordinates on the map'],
    ['Haldia Dock', 22.0300, 88.0900, 265, 1.3, 'verify coordinates on the map']
  ];
  sheet.getRange(2, 1, seedDestinations.length, seedDestinations[0].length).setValues(seedDestinations);
  sheet.autoResizeColumns(1, headers.length);
}

/**
 * Setup Stations Tab
 */
function setupStationsTab(ss) {
  var sheet = getOrCreateSheet(ss, 'Stations');
  sheet.clear();

  var headers = ['Code', 'Name', 'City', 'Lat', 'Lng', 'Notes'];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  var headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setFontWeight('bold');
  headerRange.setBackground('#1A365D');
  headerRange.setFontColor('#FFFFFF');
  sheet.setFrozenRows(1);

  var seedStations = [
    ['TATA', 'Tatanagar Jn', 'Jamshedpur', 22.7719, 86.2006, 'Base station - verify on IRCTC'],
    ['HWH', 'Howrah Jn', 'Kolkata', 22.5839, 88.3426, 'verify on IRCTC'],
    ['SRC', 'Santragachi Jn', 'Howrah', 22.5828, 88.2779, 'verify on IRCTC'],
    ['KGP', 'Kharagpur Jn', 'Kharagpur', 22.3398, 87.3256, 'Interchange - verify on IRCTC'],
    ['HLZ', 'Haldia', 'Haldia', 22.0345, 88.0815, 'Haldia-side placeholder - verify on IRCTC']
  ];
  sheet.getRange(2, 1, seedStations.length, seedStations[0].length).setValues(seedStations);
  sheet.autoResizeColumns(1, headers.length);
}

/**
 * Setup Leave Tab
 */
function setupLeaveTab(ss) {
  var sheet = getOrCreateSheet(ss, 'Leave');
  sheet.clear();

  var headers = ['Name', 'From', 'To', 'Reason'];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  var headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setFontWeight('bold');
  headerRange.setBackground('#1A365D');
  headerRange.setFontColor('#FFFFFF');
  sheet.setFrozenRows(1);

  var staffSheet = getOrCreateSheet(ss, 'Staff');
  var staffRule = SpreadsheetApp.newDataValidation()
    .requireValueInRange(staffSheet.getRange('A2:A20'), true).build();
  sheet.getRange('A2:A50').setDataValidation(staffRule);
  sheet.autoResizeColumns(1, headers.length);
}

/**
 * Setup Config Tab
 */
function setupConfigTab(ss) {
  var sheet = getOrCreateSheet(ss, 'Config');
  sheet.clear();

  var headers = ['Key', 'Value', 'Description'];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  var headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setFontWeight('bold');
  headerRange.setBackground('#1A365D');
  headerRange.setFontColor('#FFFFFF');
  sheet.setFrozenRows(1);

  var seedConfig = [
    ['MapboxToken', '', 'Public Mapbox GL token for 3D satellite view'],
    ['ViewKey', 'swift-view-2026', 'Access key for the web application URL (?key=...)'],
    ['WorkingDays', 'Mon,Tue,Wed,Thu,Fri,Sat', 'Comma-separated days of work (default Mon-Sat)'],
    ['OutboundWebhookURL', '', 'Optional n8n webhook URL for outbound WhatsApp alerts'],
    ['AlertLeadHours', '24,3,1', 'Departure alert intervals in hours before journey'],
    ['Holidays', '2026-01-26:Republic Day, 2026-08-15:Independence Day, 2026-10-02:Gandhi Jayanti', 'Comma-separated YYYY-MM-DD:Name'],
    ['Tpl_Assigned', 'Trip {{tripId}} assigned to {{staffName}} for {{destination}} on {{startDate}}. Please book train & send details.', 'WhatsApp assignment template'],
    ['Tpl_Reminder_24h', 'Reminder: Trip {{tripId}} to {{destination}} is tomorrow. Train {{trainNo}} ({{trainName}}) at {{depTime}} from {{fromStation}}.', '24h before train reminder'],
    ['Tpl_Reminder_Dep', 'Alert: Train {{trainNo}} departs in {{leadHours}}h at {{depTime}} from {{fromStation}}. Carry {{docType}}.', '3h and 1h departure reminder'],
    ['Tpl_Ticket_Missing', 'Alert: Ticket not booked for Trip {{tripId}} to {{destination}} departing in 24 hours. Please confirm.', 'Ticket unbooked warning'],
    ['Tpl_Post_Arrival', 'Trip {{tripId}}: You should have reached {{destination}}. Please reply Reached or Delivered.', '2h post arrival status check']
  ];

  sheet.getRange(2, 1, seedConfig.length, seedConfig[0].length).setValues(seedConfig);
  sheet.autoResizeColumns(1, headers.length);
}

/**
 * Setup Inbox Tab (Audit for inbound WhatsApp)
 */
function setupInboxTab(ss) {
  var sheet = getOrCreateSheet(ss, 'Inbox');
  sheet.clear();

  var headers = [
    'Timestamp', 'FromPhone', 'MessageId', 'RawText',
    'ParsedIntent', 'ParsedDestination', 'ParsedDate', 'Result', 'TripID'
  ];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  var headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setFontWeight('bold');
  headerRange.setBackground('#1A365D');
  headerRange.setFontColor('#FFFFFF');
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, headers.length);
}

/**
 * Setup Alerts Tab (Hidden deduplication store)
 */
function setupAlertsTab(ss) {
  var sheet = getOrCreateSheet(ss, 'Alerts');
  sheet.clear();

  var headers = ['TripID', 'AlertType', 'SentAt', 'PayloadHash'];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  var headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setFontWeight('bold');
  headerRange.setBackground('#1A365D');
  headerRange.setFontColor('#FFFFFF');
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, headers.length);
  sheet.hideSheet();
}

/**
 * Setup Log Tab (Audit log)
 */
function setupLogTab(ss) {
  var sheet = getOrCreateSheet(ss, 'Log');
  sheet.clear();

  var headers = ['Timestamp', 'Actor', 'Action', 'TripID', 'Details'];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  var headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setFontWeight('bold');
  headerRange.setBackground('#1A365D');
  headerRange.setFontColor('#FFFFFF');
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, headers.length);
}

/**
 * Installable Triggers Setup
 */
function setupInstallableTriggers() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var triggers = ScriptApp.getProjectTriggers();
  
  // Remove old triggers created for this project to avoid duplicates
  for (var i = 0; i < triggers.length; i++) {
    var func = triggers[i].getHandlerFunction();
    if (func === 'handleSheetEdit' || func === 'checkAndSendTrainAlerts') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }

  // 1. Installable onEdit trigger for Trips
  ScriptApp.newTrigger('handleSheetEdit')
    .forSpreadsheet(ss)
    .onEdit()
    .create();

  // 2. Time-driven trigger for Alerts (Every 15 minutes)
  ScriptApp.newTrigger('checkAndSendTrainAlerts')
    .timeBased()
    .everyMinutes(15)
    .create();
}
