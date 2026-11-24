/**
 * Swift Trip Planner - Assign.gs
 * Client: Swift Strips India Pvt. Ltd. (SLTT Group), Jamshedpur, Jharkhand, India
 * 
 * Round-Robin Allotment Engine:
 * - Deterministic, testable, balanced load allocation.
 * - Dynamic by date, leave schedule, overlaps, destination distance/weight.
 * - Reschedule resilience, manual override handling, new joiner baseline calculation.
 */

/**
 * Triggered onEdit for spreadsheet
 */
function handleSheetEdit(e) {
  if (!e || !e.range) return;
  var sheet = e.range.getSheet();
  if (sheet.getName() !== 'Trips') return;

  var row = e.range.getRow();
  var col = e.range.getColumn();
  if (row < 2) return; // ignore header

  var tripId = sheet.getRange(row, 1).getValue();
  var assignedTo = sheet.getRange(row, 8).getValue();
  var assignMode = sheet.getRange(row, 9).getValue();
  var overrideReason = sheet.getRange(row, 10).getValue();
  var status = sheet.getRange(row, 11).getValue();

  // If user manually changed AssignedTo (Col 8)
  if (col === 8) {
    if (assignedTo && assignMode !== 'MANUAL') {
      sheet.getRange(row, 9).setValue('MANUAL');
      logAction('USER', 'MANUAL_OVERRIDE', tripId, 'Assigned manually to ' + assignedTo + (overrideReason ? ' (' + overrideReason + ')' : ''));
    }
  }

  // If StartDate (Col 5) or EndDate (Col 6) changed, re-validate assignment
  if (col === 5 || col === 6) {
    var startDate = sheet.getRange(row, 5).getValue();
    var endDate = sheet.getRange(row, 6).getValue() || startDate;
    var dest = sheet.getRange(row, 4).getValue();
    var priority = sheet.getRange(row, 7).getValue() || 'Normal';

    if (startDate && dest && assignMode === 'AUTO') {
      // Re-run allotment if date moved
      var best = findEligibleStaffForTrip(new Date(startDate), new Date(endDate), dest, priority, true, row);
      if (best) {
        sheet.getRange(row, 8).setValue(best.name);
        sheet.getRange(row, 11).setValue('Assigned');
        logAction('ENGINE', 'RESCHEDULE_ASSIGN', tripId, 'Reassigned to ' + best.name + ' after date change');
      } else {
        sheet.getRange(row, 8).setValue('');
        sheet.getRange(row, 11).setValue('Needs reassignment');
        logAction('ENGINE', 'NO_ELIGIBLE_STAFF', tripId, 'No eligible staff found after date change');
      }
    }
  }

  // Stamp LastUpdated (Col 29)
  sheet.getRange(row, 29).setValue(Utilities.formatDate(new Date(), "Asia/Kolkata", "yyyy-MM-dd HH:mm:ss"));
}

/**
 * Predicts who will be next in rotation for a standard 1-day trip starting today/tomorrow
 */
function predictNextRotationStaff() {
  var today = new Date();
  var tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
  var eligible = findEligibleStaffForTrip(tomorrow, tomorrow, 'Kolkata', 'Normal', false);
  return eligible ? eligible.name : 'Mohit Saw';
}

/**
 * Finds the best eligible staff for a trip using fair weighted round-robin rules.
 * 
 * Filter chain:
 * 1. Active == TRUE
 * 2. Not on Leave between startDate and endDate
 * 3. No overlapping non-cancelled trip
 * 4. Avoids Sundays & Holidays unless priority == 'Urgent'
 * 
 * Selection:
 * - Minimum WeightedLoad in the month of startDate
 * - Tie-break 1: Longest elapsed time since last non-cancelled trip end
 * - Tie-break 2: Sheet order
 */
function findEligibleStaffForTrip(startDate, endDate, destination, priority, preserveCurrentIfEligible, excludeRowIndex) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var staffSheet = ss.getSheetByName('Staff');
  var leaveSheet = ss.getSheetByName('Leave');
  var tripsSheet = ss.getSheetByName('Trips');
  var destSheet = ss.getSheetByName('Destinations');
  var config = getConfigMap();

  var sDate = new Date(startDate);
  var eDate = endDate ? new Date(endDate) : new Date(startDate);
  sDate.setHours(0, 0, 0, 0);
  eDate.setHours(23, 59, 59, 999);

  // Check working day / holiday rule if not urgent
  if (priority !== 'Urgent') {
    var workingDays = (config['WorkingDays'] || 'Mon,Tue,Wed,Thu,Fri,Sat').split(',').map(function(d){ return d.trim(); });
    var startDay = Utilities.formatDate(sDate, "Asia/Kolkata", "EEE");
    if (workingDays.indexOf(startDay) === -1) {
      // Non-working day
      return null;
    }
    // Check holiday list
    var holidaysStr = config['Holidays'] || '';
    var sDateStr = Utilities.formatDate(sDate, "Asia/Kolkata", "yyyy-MM-dd");
    if (holidaysStr.indexOf(sDateStr) !== -1) {
      return null; // holiday
    }
  }

  // 1. Destination Weights map
  var destData = destSheet.getDataRange().getValues();
  var destWeights = {};
  for (var d = 1; d < destData.length; d++) {
    var dName = destData[d][0];
    var weight = Number(destData[d][4]) || 1.0;
    if (dName) destWeights[dName] = weight;
  }

  // 2. Fetch Active Staff
  var staffData = staffSheet.getDataRange().getValues();
  var candidateStaff = [];
  for (var s = 1; s < staffData.length; s++) {
    var name = staffData[s][0];
    var active = staffData[s][3];
    var joinDate = staffData[s][5] ? new Date(staffData[s][5]) : new Date('2024-01-01');
    if (name && (active === true || active === 'TRUE')) {
      candidateStaff.push({
        name: name,
        sheetIndex: s,
        joinDate: joinDate,
        load: 0,
        lastTripEnd: new Date('1970-01-01')
      });
    }
  }

  if (candidateStaff.length === 0) return null;

  // 3. Check Leaves
  var leaveData = leaveSheet.getDataRange().getValues();
  var onLeaveStaff = {};
  for (var l = 1; l < leaveData.length; l++) {
    var lName = leaveData[l][0];
    var lFrom = leaveData[l][1] ? new Date(leaveData[l][1]) : null;
    var lTo = leaveData[l][2] ? new Date(leaveData[l][2]) : lFrom;
    if (lName && lFrom && lTo) {
      lFrom.setHours(0, 0, 0, 0);
      lTo.setHours(23, 59, 59, 999);
      // If trip overlaps with leave
      if (sDate <= lTo && eDate >= lFrom) {
        onLeaveStaff[lName] = true;
      }
    }
  }

  // 4. Check Overlapping Trips and Calculate Existing Monthly Weighted Load
  var targetMonth = Utilities.formatDate(sDate, "Asia/Kolkata", "yyyy-MM");
  var tripsData = tripsSheet.getDataRange().getValues();
  var overlappingStaff = {};
  var staffLoads = {};
  var staffTripCounts = {};
  var lastTripEndMap = {};

  for (var c = 0; c < candidateStaff.length; c++) {
    staffLoads[candidateStaff[c].name] = 0;
    staffTripCounts[candidateStaff[c].name] = 0;
    lastTripEndMap[candidateStaff[c].name] = new Date('1970-01-01');
  }

  for (var t = 1; t < tripsData.length; t++) {
    if (excludeRowIndex && (t + 1) === excludeRowIndex) continue; // ignore current row if updating

    var tStatus = tripsData[t][10];
    if (tStatus === 'Cancelled') continue; // cancelled trips don't block and don't add load

    var tAssigned = tripsData[t][7];
    if (!tAssigned || !staffLoads.hasOwnProperty(tAssigned)) continue;

    var tStart = tripsData[t][4] ? new Date(tripsData[t][4]) : null;
    var tEnd = tripsData[t][5] ? new Date(tripsData[t][5]) : tStart;
    var tDest = tripsData[t][3];

    if (tStart && tEnd) {
      tStart.setHours(0, 0, 0, 0);
      tEnd.setHours(23, 59, 59, 999);

      // Check overlap with requested trip
      if (sDate <= tEnd && eDate >= tStart) {
        overlappingStaff[tAssigned] = true;
      }

      // Track last trip end for tie breaking
      if (tEnd > lastTripEndMap[tAssigned]) {
        lastTripEndMap[tAssigned] = tEnd;
      }

      // If in same month, add to weighted load
      var tripMonth = Utilities.formatDate(tStart, "Asia/Kolkata", "yyyy-MM");
      if (tripMonth === targetMonth) {
        var durationDays = Math.max(1, Math.round((tEnd.getTime() - tStart.getTime()) / (24 * 3600 * 1000)) + 1);
        var weight = destWeights[tDest] || 1.0;
        staffLoads[tAssigned] += (weight * durationDays);
        staffTripCounts[tAssigned]++;
      }
    }
  }

  // 5. Calculate Average Load for New Joiners
  var totalLoad = 0;
  var countWithTrips = 0;
  for (var st in staffLoads) {
    if (staffTripCounts[st] > 0) {
      totalLoad += staffLoads[st];
      countWithTrips++;
    }
  }
  var averageMonthLoad = countWithTrips > 0 ? (totalLoad / countWithTrips) : 0;

  // Filter candidates & populate stats
  var eligible = [];
  var currentMonthStart = new Date(sDate.getFullYear(), sDate.getMonth(), 1);

  for (var i = 0; i < candidateStaff.length; i++) {
    var candidate = candidateStaff[i];
    var cName = candidate.name;

    // Filter out if on leave or already on another trip
    if (onLeaveStaff[cName]) continue;
    if (overlappingStaff[cName]) continue;

    var cLoad = staffLoads[cName];
    // New joiner leveling rule: if joined in current month and no trips yet, start at average
    if (candidate.joinDate >= currentMonthStart && staffTripCounts[cName] === 0) {
      cLoad = averageMonthLoad;
    }

    candidate.load = cLoad;
    candidate.lastTripEnd = lastTripEndMap[cName];
    eligible.push(candidate);
  }

  if (eligible.length === 0) {
    return null; // No eligible staff
  }

  // Deterministic sorting:
  // 1. Lowest Weighted Load
  // 2. Tie break: Longest since last trip (earliest lastTripEnd)
  // 3. Tie break: Sheet order (sheetIndex)
  eligible.sort(function(a, b) {
    if (Math.abs(a.load - b.load) > 0.001) {
      return a.load - b.load;
    }
    if (a.lastTripEnd.getTime() !== b.lastTripEnd.getTime()) {
      return a.lastTripEnd.getTime() - b.lastTripEnd.getTime();
    }
    return a.sheetIndex - b.sheetIndex;
  });

  return eligible[0];
}

/**
 * Assigns all trips currently marked as 'Pending approval' or unassigned
 */
function assignAllPendingTrips() {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (e) {
    return 0;
  }

  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('Trips');
    var data = sheet.getDataRange().getValues();
    var assignedCount = 0;

    for (var r = 1; r < data.length; r++) {
      var tripId = data[r][0];
      var dest = data[r][3];
      var startDate = data[r][4];
      var endDate = data[r][5] || startDate;
      var priority = data[r][6] || 'Normal';
      var assignedTo = data[r][7];
      var status = data[r][10];

      if (tripId && dest && startDate && (!assignedTo || status === 'Needs reassignment')) {
        var best = findEligibleStaffForTrip(new Date(startDate), new Date(endDate), dest, priority, false, r + 1);
        if (best) {
          sheet.getRange(r + 1, 8).setValue(best.name);
          sheet.getRange(r + 1, 9).setValue('AUTO');
          sheet.getRange(r + 1, 11).setValue('Assigned');
          sheet.getRange(r + 1, 29).setValue(Utilities.formatDate(new Date(), "Asia/Kolkata", "yyyy-MM-dd HH:mm:ss"));
          logAction('ENGINE', 'AUTO_ALLOT', tripId, 'Allotted to ' + best.name + ' (Load: ' + best.load.toFixed(1) + ')');
          assignedCount++;
        } else {
          sheet.getRange(r + 1, 11).setValue('Needs reassignment');
          logAction('ENGINE', 'ALLOT_FAIL', tripId, 'No eligible staff found');
        }
      }
    }
    return assignedCount;
  } finally {
    lock.releaseLock();
  }
}

/**
 * Creates and assigns multiple trips for batch testing or monthly generation
 */
function batchCreateMonthlyTrips(destination, count) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
  } catch (e) {
    return 0;
  }

  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('Trips');
    var today = new Date();
    var created = 0;
    var dayOffset = 1;

    while (created < count && dayOffset <= 60) {
      var targetDate = new Date(today.getTime() + dayOffset * 24 * 60 * 60 * 1000);
      var dayName = Utilities.formatDate(targetDate, "Asia/Kolkata", "EEE");

      if (dayName !== 'Sun') {
        var tripYearMonth = Utilities.formatDate(targetDate, "Asia/Kolkata", "yyyy-MM");
        var tripSeq = String(sheet.getLastRow()).padStart(3, '0');
        var tripId = 'TRP-' + tripYearMonth + '-' + tripSeq;

        var best = findEligibleStaffForTrip(targetDate, targetDate, destination, 'Normal', false);
        var staffName = best ? best.name : '';
        var status = best ? 'Assigned' : 'Needs reassignment';

        var newRow = [
          tripId, 'Document delivery', 'Invoice', destination,
          Utilities.formatDate(targetDate, "Asia/Kolkata", "yyyy-MM-dd"),
          Utilities.formatDate(targetDate, "Asia/Kolkata", "yyyy-MM-dd"),
          'Normal', staffName, 'AUTO', '', status,
          'Train', 'TATA', 'HWH', '12814', 'Steel Express',
          Utilities.formatDate(targetDate, "Asia/Kolkata", "yyyy-MM-dd'T'06:10:00"),
          Utilities.formatDate(targetDate, "Asia/Kolkata", "yyyy-MM-dd'T'10:20:00"),
          '12813', 'Steel Express',
          Utilities.formatDate(targetDate, "Asia/Kolkata", "yyyy-MM-dd'T'17:25:00"),
          Utilities.formatDate(targetDate, "Asia/Kolkata", "yyyy-MM-dd'T'21:30:00"),
          'Booked', 'CC', 'SHEET', 'Coordinator', '', 'Batch generated trip',
          Utilities.formatDate(new Date(), "Asia/Kolkata", "yyyy-MM-dd HH:mm:ss")
        ];

        sheet.appendRow(newRow);
        created++;
      }
      dayOffset++;
    }
    return created;
  } finally {
    lock.releaseLock();
  }
}

/**
 * Calculates current month fairness statistics
 */
function calculateFairnessStatistics() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tripsSheet = ss.getSheetByName('Trips');
  var destSheet = ss.getSheetByName('Destinations');
  var staffSheet = ss.getSheetByName('Staff');

  var currentMonth = Utilities.formatDate(new Date(), "Asia/Kolkata", "yyyy-MM");

  // Dest Weights
  var destWeights = {};
  var dData = destSheet.getDataRange().getValues();
  for (var d = 1; d < dData.length; d++) {
    if (dData[d][0]) destWeights[dData[d][0]] = Number(dData[d][4]) || 1.0;
  }

  // Active Staff
  var staffLoads = {};
  var tripCounts = {};
  var sData = staffSheet.getDataRange().getValues();
  for (var s = 1; s < sData.length; s++) {
    var sName = sData[s][0];
    var active = sData[s][3];
    if (sName && (active === true || active === 'TRUE')) {
      staffLoads[sName] = 0;
      tripCounts[sName] = 0;
    }
  }

  // Aggregate
  var tData = tripsSheet.getDataRange().getValues();
  for (var t = 1; t < tData.length; t++) {
    var status = tData[t][10];
    if (status === 'Cancelled') continue;

    var assigned = tData[t][7];
    var startVal = tData[t][4];
    var endVal = tData[t][5] || startVal;
    var dest = tData[t][3];

    if (assigned && staffLoads.hasOwnProperty(assigned) && startVal) {
      var startDate = new Date(startVal);
      var endDate = new Date(endVal);
      var month = Utilities.formatDate(startDate, "Asia/Kolkata", "yyyy-MM");

      if (month === currentMonth) {
        var days = Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / (24 * 3600 * 1000)) + 1);
        var weight = destWeights[dest] || 1.0;
        staffLoads[assigned] += (weight * days);
        tripCounts[assigned]++;
      }
    }
  }

  var loads = [];
  for (var st in staffLoads) {
    loads.push(staffLoads[st]);
  }

  var minLoad = loads.length ? Math.min.apply(null, loads) : 0;
  var maxLoad = loads.length ? Math.max.apply(null, loads) : 0;
  var fairnessGap = maxLoad - minLoad;

  return {
    month: currentMonth,
    staffLoads: staffLoads,
    tripCounts: tripCounts,
    minLoad: minLoad,
    maxLoad: maxLoad,
    fairnessGap: fairnessGap
  };
}
