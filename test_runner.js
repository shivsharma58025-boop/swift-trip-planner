/**
 * Swift Trip Planner - Local Node.js Verification Runner
 * Runs the self-contained test suite, parser validations, and 45-trip simulation.
 */

// 1. Mock minimal Logger and Utilities for local Node execution
global.Logger = {
  log: function(msg) { console.log(msg); }
};

global.Utilities = {
  formatDate: function(date, tz, fmt) {
    if (fmt === "Asia/Kolkata" || tz === "Asia/Kolkata") {
      const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      const d = String(date.getDate()).padStart(2, '0');
      const m = months[date.getMonth()];
      const y = date.getFullYear();
      if (fmt === "dd-MMM-yyyy") return `${d}-${m}-${y}`;
      if (fmt === "yyyy-MM") return `${y}-${String(date.getMonth()+1).padStart(2, '0')}`;
      if (fmt === "yyyy-MM-dd") return `${y}-${String(date.getMonth()+1).padStart(2, '0')}-${d}`;
    }
    return date.toISOString();
  }
};

// 2. Load Parser logic
function sanitizeInput(str) {
  if (!str) return '';
  var s = String(str).trim();
  if (/^[=\+\-@]/.test(s)) {
    return "'" + s;
  }
  return s;
}

function parseTripRequest(text) {
  var t = text.toLowerCase();

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

  var priority = 'Normal';
  if (/urgent|urgently|emergency|jaldi|turant|asap|priority/i.test(t)) {
    priority = 'Urgent';
  }

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

  var date = parseDateFromText(t);

  return {
    destination: destination,
    date: date,
    priority: priority,
    docType: docType
  };
}

function parseDateFromText(text) {
  var now = new Date();
  var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (/\b(today|aaj)\b/i.test(text)) {
    return today;
  }
  if (/\b(tomorrow|kal|tmrw|tom)\b/i.test(text)) {
    return new Date(today.getTime() + 1 * 24 * 60 * 60 * 1000);
  }
  if (/\b(parso|day after tomorrow)\b/i.test(text)) {
    return new Date(today.getTime() + 2 * 24 * 60 * 60 * 1000);
  }

  var daysMap = {
    'sun': 0, 'sunday': 0, 'itwar': 0, 'ravivar': 0,
    'mon': 1, 'monday': 1, 'som': 1, 'somwar': 1,
    'tue': 2, 'tuesday': 2, 'mangal': 2, 'mangalwar': 2,
    'wed': 3, 'wednesday': 3, 'budh': 3, 'budhwar': 3,
    'thu': 4, 'thursday': 4, 'guru': 4, 'guruwar': 4,
    'fri': 5, 'friday': 5, 'shukra': 5, 'shukrawar': 5,
    'sat': 6, 'saturday': 6, 'shani': 6, 'shaniwar': 6
  };

  for (var key in daysMap) {
    var regex = new RegExp('\\b' + key + '\\b', 'i');
    if (regex.test(text)) {
      var targetDay = daysMap[key];
      var diff = targetDay - today.getDay();
      if (diff <= 0) diff += 7;
      return new Date(today.getTime() + diff * 24 * 60 * 60 * 1000);
    }
  }

  var monthNames = {
    'jan': 0, 'feb': 1, 'mar': 2, 'apr': 3, 'may': 4, 'jun': 5,
    'jul': 6, 'aug': 7, 'sep': 8, 'oct': 9, 'nov': 10, 'dec': 11
  };

  var dMmmMatch = text.match(/(\d{1,2})(?:st|nd|rd|th)?[\s\-\/\.](jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i);
  if (!dMmmMatch) {
    dMmmMatch = text.match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[\s\-\/\.](\d{1,2})/i);
    if (dMmmMatch) {
      var mStr = dMmmMatch[1].toLowerCase().slice(0, 3);
      var dayNum = parseInt(dMmmMatch[2], 10);
      return new Date(now.getFullYear(), monthNames[mStr], dayNum);
    }
  } else {
    var dayNum = parseInt(dMmmMatch[1], 10);
    var mStr = dMmmMatch[2].toLowerCase().slice(0, 3);
    return new Date(now.getFullYear(), monthNames[mStr], dayNum);
  }

  var numDateMatch = text.match(/\b(\d{1,2})[\/\-\.](\d{1,2})(?:[\/\-\.](\d{2,4}))?\b/);
  if (numDateMatch) {
    var day = parseInt(numDateMatch[1], 10);
    var month = parseInt(numDateMatch[2], 10) - 1;
    var year = numDateMatch[3] ? parseInt(numDateMatch[3], 10) : now.getFullYear();
    if (year < 100) year += 2000;
    return new Date(year, month, day);
  }

  return null;
}

function parseStatusCommand(text) {
  var t = text.trim();
  var bookedMatch = t.match(/^booked\s*(.*)$/i);
  if (bookedMatch) return { action: 'BOOKED', details: bookedMatch[1] };
  if (/^(departed|on train|nikal gaya)/i.test(t)) return { action: 'DEPARTED' };
  if (/^(reached|pahunch gaya)/i.test(t)) return { action: 'REACHED' };
  if (/^(delivered|paper diya|done)/i.test(t)) return { action: 'DELIVERED' };
  if (/^(returning|wapas)/i.test(t)) return { action: 'RETURNING' };
  if (/^(back|returned)/i.test(t)) return { action: 'RETURNED' };
  if (/^(can'?t go|cannot go|nahi ja sakta)/i.test(t)) return { action: 'CANT_GO' };
  return null;
}

function simulateRotationFairness(totalTrips) {
  var staff = [
    { name: "Mohit Saw", load: 0, trips: 0, lastTripDate: 0 },
    { name: "Dablu Pandit", load: 0, trips: 0, lastTripDate: 0 },
    { name: "Suraj Kumar", load: 0, trips: 0, lastTripDate: 0 },
    { name: "Abhinas", load: 0, trips: 0, lastTripDate: 0 }
  ];

  var destinations = [
    { name: "Kolkata", weight: 1.0 },
    { name: "Haldia", weight: 1.2 },
    { name: "Kolkata Port", weight: 1.3 }
  ];

  for (var day = 1; day <= totalTrips; day++) {
    var dest = destinations[day % destinations.length];

    var candidates = staff.slice().sort(function(a, b) {
      if (Math.abs(a.load - b.load) > 0.001) {
        return a.load - b.load;
      }
      return a.lastTripDate - b.lastTripDate;
    });

    var chosen = candidates[0];
    chosen.load += dest.weight;
    chosen.trips++;
    chosen.lastTripDate = day;
  }

  var loads = staff.map(function(s) { return s.load; });
  var minLoad = Math.min.apply(null, loads);
  var maxLoad = Math.max.apply(null, loads);
  var fairnessGap = maxLoad - minLoad;

  var reportLines = staff.map(function(s) {
    return "  • " + s.name + ": " + s.trips + " trips | " + s.load.toFixed(1) + " weighted units";
  });
  reportLines.push("  • Fairness Spread (Max - Min): " + fairnessGap.toFixed(1) + " units");

  return {
    fairnessGap: fairnessGap,
    report: reportLines.join("\n")
  };
}

// Execute tests
console.log("==================================================");
console.log("RUNNING SWIFT TRIP PLANNER TEST VERIFICATION SUITE");
console.log("==================================================");

let passed = 0;
let failed = 0;
function test(name, condition) {
  if (condition) {
    passed++;
    console.log(`[PASS] ${name}`);
  } else {
    failed++;
    console.error(`[FAIL] ${name}`);
  }
}

// 1. NLP Parser Tests
test("Parser: 'Kolkata 28 Nov'", parseTripRequest("Kolkata 28 Nov").destination === "Kolkata");
test("Parser: 'Haldia kal urgent'", parseTripRequest("Haldia kal urgent").priority === "Urgent");
test("Parser: 'port parso bank docs'", parseTripRequest("port parso bank docs").docType === "Bank");
test("Parser: 'Howrah 3 Dec invoice'", parseTripRequest("Howrah 3 Dec invoice").destination === "Kolkata");
test("Parser: 'haldia dock somwar'", parseTripRequest("haldia dock somwar").destination === "Haldia Dock");
test("Parser: 'Kolkata aaj'", parseTripRequest("Kolkata aaj").date !== null);
test("Parser: 'calcutta 15/12 customs'", parseTripRequest("calcutta 15/12 customs").docType === "Customs");
test("Parser: 'emergency' -> Urgent", parseTripRequest("Haldia emergency").priority === "Urgent");
test("Parser: 'SRC' -> Kolkata", parseTripRequest("SRC 5 Jan").destination === "Kolkata");
test("Parser: Status 'Booked 12814 06:10'", parseStatusCommand("Booked 12814 06:10").action === "BOOKED");
test("Parser: Status 'Departed'", parseStatusCommand("Departed").action === "DEPARTED");
test("Parser: Status 'Reached'", parseStatusCommand("Reached").action === "REACHED");
test("Parser: Status 'Delivered'", parseStatusCommand("Delivered").action === "DELIVERED");
test("Parser: Status 'Can't go'", parseStatusCommand("Can't go").action === "CANT_GO");
test("Parser: Status 'Back'", parseStatusCommand("Back").action === "RETURNED");

// 2. Sanitizer Tests
test("Sanitization: '=SUM(A1)'", sanitizeInput("=SUM(A1)") === "'=SUM(A1)");
test("Sanitization: '+cmd'", sanitizeInput("+cmd") === "'+cmd");
test("Sanitization: '-123'", sanitizeInput("-123") === "'-123");
test("Sanitization: '@macro'", sanitizeInput("@macro") === "'@macro");
test("Sanitization: Safe text unchanged", sanitizeInput("Normal Text") === "Normal Text");

// 3. Fairness Simulation (45 Trips over 3 Months)
console.log("\n45-TRIP ROTATION FAIRNESS SIMULATION:");
const sim = simulateRotationFairness(45);
console.log(sim.report);
test("Simulation: Fairness Gap <= 1.0 weight unit", sim.fairnessGap <= 1.0);

console.log("\n--------------------------------------------------");
console.log(`TOTAL TESTS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
console.log("--------------------------------------------------");
