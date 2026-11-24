# Swift Trip Planner - Deployment & Operations Guide (SETUP.md)
**Client:** Swift Strips India Pvt. Ltd. (SLTT Group), Jamshedpur, Jharkhand, India  
**Owner:** Satyam (Senior Software Lead)  
**Base:** Swift Strips Plant, Jamshedpur (22.8046° N, 86.2029° E)  
**Timezone:** Asia/Kolkata (IST)

---

## 10-Step Setup Guide (Non-Developer Friendly)

Follow these 10 steps to deploy Swift Trip Planner in under 10 minutes:

### Step 1: Create a New Google Sheet
1. Open Google Chrome and go to [sheets.new](https://sheets.new).
2. Rename the spreadsheet to `Swift Trip Planner - SLTT Group`.

### Step 2: Open Google Apps Script
1. In the top menu, click **Extensions** > **Apps Script**.
2. Rename the project from `Untitled project` to `Swift Trip Planner Backend`.

### Step 3: Copy and Paste the Files
Delete any default content in `Code.gs` and create the following files with the exact names:
1. `Setup.gs`: Paste contents of `Setup.gs`.
2. `Code.gs`: Paste contents of `Code.gs`.
3. `Assign.gs`: Paste contents of `Assign.gs`.
4. `Parser.gs`: Paste contents of `Parser.gs`.
5. `Notify.gs`: Paste contents of `Notify.gs`.
6. `Tests.gs`: Paste contents of `Tests.gs`.
7. `Index.html`: Click the **+** icon beside Files > select **HTML**, name it `Index`, and paste the contents of `Index.html`.
8. Click the **Save Project** (disk) icon or press `Ctrl + S`.

### Step 4: Run `setup()` Once
1. In the Apps Script toolbar dropdown (next to "Debug"), select the function **`setup`**.
2. Click **Run**.
3. Google will ask for authorization: click **Review Permissions** > Choose your account > Click **Advanced** > Click **Go to Swift Trip Planner (unsafe)** > Click **Allow**.
4. The execution log will show completed. Switch back to your Google Sheet: you will see all 9 formatted tabs (`Trips`, `Staff`, `Destinations`, `Stations`, `Leave`, `Config`, `Inbox`, `Alerts`, `Log`) created with seed data, formulas, validations, and the custom **Trip Planner** menu.

### Step 5: Configure Script Properties (Shared Secret)
1. In Apps Script, click **Project Settings** (gear icon on the left navigation bar).
2. Scroll down to **Script Properties** and click **Edit script properties**.
3. Click **Add script property**:
   - **Property:** `WHATSAPP_SHARED_SECRET`
   - **Value:** `<YOUR_CHOSEN_SECRET_TOKEN>` (e.g. `swift-secret-token-2026`)
4. Click **Save script properties**.

### Step 6: Configure Mapbox Token (Optional for 3D View)
1. If you want the full 3D satellite view with terrain and sky, get a free public token at [mapbox.com](https://www.mapbox.com/).
2. In your Google Sheet, switch to the **Config** tab.
3. Paste the public token into cell **B2** (`MapboxToken`).
4. *(Note: If left blank, the app will automatically fall back to Leaflet 2D with Esri World Satellite imagery without any errors).*

### Step 7: Verify ViewKey Security
1. In the **Config** tab, verify cell **B3** (`ViewKey`). By default, it is set to `swift-view-2026`.
2. You can customize this string anytime to restrict viewer access.

### Step 8: Deploy Web App
1. In the Apps Script editor, click the blue **Deploy** button (top right) > **New deployment**.
2. Click the gear icon next to "Select type" and select **Web app**.
3. Fill in the details:
   - **Description:** `Swift Trip Planner Production v1`
   - **Execute as:** `Me (your email)`
   - **Who has access:** `Anyone` (Access is protected by your `?key=ViewKey` token).
4. Click **Deploy**.
5. Copy the **Web App URL** (e.g. `https://script.google.com/macros/s/.../exec`).
6. Append your view key: `https://script.google.com/macros/s/.../exec?key=swift-view-2026`. Bookmark this link on desktop and mobile phones!

### Step 9: Configure n8n Workflow for WhatsApp (Optional)
If connecting WhatsApp Business API via n8n:
1. Open n8n and import the provided workflow template below.
2. In the HTTP Request node, paste your Web App URL.
3. Add the header or query parameter `secret` matching `WHATSAPP_SHARED_SECRET`.
4. In the Sheet's **Config** tab, set cell **B5** (`OutboundWebhookURL`) to your n8n outbound alert webhook URL.

### Step 10: Run the Test Checklist
1. In Google Sheets, refresh the page to load the custom **Trip Planner** menu.
2. Click **Trip Planner** > **Rebuild fairness numbers** to verify rotation calculation.
3. Click **Trip Planner** > **Preview next 30 days** to inspect rotation projection in the `Preview` tab.
4. In Apps Script, select `runAllTests` and click **Run** to verify all 21 test assertions pass.

---

## Rollback & Maintenance Note
If an erroneous edit or script version needs to be rolled back:
1. In Apps Script, click **Deploy** > **Manage deployments**.
2. Click the **Edit** (pencil) icon, change the version to the prior version number, and click **Deploy**.
3. In Google Sheets, use **File** > **Version history** to restore the sheet tabs to any earlier snapshot.

---

## n8n Workflow JSON Export (WhatsApp Gateway)

Import this minimal workflow into n8n:

```json
{
  "name": "Swift Trip Planner - WhatsApp Gateway",
  "nodes": [
    {
      "parameters": {
        "updates": ["messages"],
        "additionalFields": {}
      },
      "id": "1",
      "name": "WhatsApp Trigger",
      "type": "n8n-nodes-base.whatsAppTrigger",
      "typeVersion": 1,
      "position": [240, 300]
    },
    {
      "parameters": {
        "method": "POST",
        "url": "https://script.google.com/macros/s/YOUR_DEPLOYED_ID/exec",
        "sendBody": true,
        "specifyBody": "json",
        "jsonBody": "={\n  \"phone\": \"{{ $json.messages[0].from }}\",\n  \"text\": \"{{ $json.messages[0].text.body }}\",\n  \"messageId\": \"{{ $json.messages[0].id }}\",\n  \"timestamp\": \"{{ $json.messages[0].timestamp }}\",\n  \"secret\": \"swift-secret-token-2026\"\n}",
        "options": {}
      },
      "id": "2",
      "name": "Apps Script Post",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.1,
      "position": [460, 300]
    },
    {
      "parameters": {
        "operation": "send",
        "phoneNumberId": "YOUR_PHONE_NUMBER_ID",
        "recipientPhoneNumber": "={{ $json.replyTo }}",
        "textBody": "={{ $json.text }}"
      },
      "id": "3",
      "name": "WhatsApp Reply",
      "type": "n8n-nodes-base.whatsApp",
      "typeVersion": 1,
      "position": [680, 300]
    }
  ],
  "connections": {
    "WhatsApp Trigger": {
      "main": [
        [{ "node": "Apps Script Post", "type": "main", "index": 0 }]
      ]
    },
    "Apps Script Post": {
      "main": [
        [{ "node": "WhatsApp Reply", "type": "main", "index": 0 }]
      ]
    }
  }
}
```

---

## WhatsApp Pre-Approved Template Submissions

WhatsApp Business API permits free-form replies only within a 24-hour service window. For scheduled alerts (24h before departure, 3h lead, unbooked ticket), submit these templates in Meta WhatsApp Manager:

1. **Trip Assignment Template (`trip_assigned`)**:
   > "Trip {{1}} assigned to {{2}} for {{3}} on {{4}}. Please book train ticket and reply with train details."
2. **Day-Before Reminder (`trip_reminder_24h`)**:
   > "Reminder: Trip {{1}} to {{2}} is tomorrow. Train {{3}} at {{4}} from {{5}}."
3. **Train Departure Alert (`trip_departure_lead`)**:
   > "Alert: Train {{1}} departs in {{2}} hour(s) at {{3}} from {{4}}. Document to carry: {{5}}."
4. **Unbooked Ticket Warning (`trip_ticket_missing`)**:
   > "Urgent: Ticket not yet booked for Trip {{1}} to {{2}} departing in 24 hours. Please confirm status."
5. **Post-Arrival Check (`trip_post_arrival`)**:
   > "Trip {{1}}: You should have reached {{2}}. Please reply with 'Reached' or 'Delivered'."

---

## 1-Page Real-Message Test Script

Test these messages from authorized WhatsApp numbers:

| Test # | Inbound WhatsApp Text | Expected System Response | Sheet Result |
| :--- | :--- | :--- | :--- |
| **T-01** | `Kolkata 28 Nov` | "Trip TRP-2026-11-XXX created! Assigned to: Mohit Saw for Kolkata on 28-Nov-2026." | Trip created, `AssignedTo=Mohit Saw`, `Status=Assigned`. |
| **T-02** | `Haldia kal urgent` | "Trip TRP-2026-11-XXX created! Assigned to: Dablu Pandit for Haldia on [Tomorrow] (Urgent)." | Priority=Urgent, allotted to next in rotation. |
| **T-03** | `port parso bank docs` | "Trip TRP-2026-11-XXX created! Assigned to: Suraj Kumar for Kolkata Port." | DocType=Bank, Destination=Kolkata Port. |
| **T-04** | `Howrah 3 Dec invoice` | "Trip TRP-2026-11-XXX created! Assigned to: Abhinas for Kolkata." | Destination mapped to Kolkata, DocType=Invoice. |
| **T-05** | `Kolkata` *(missing date)* | "Which date is this trip for? (e.g., today/aaj, tomorrow/kal, or DD-MMM)." | Logged as INCOMPLETE in Inbox; no trip created. |
| **T-06** | `Booked 12814 06:10` | "Ticket details noted for TRP-2026-11-XXX. Safe travels!" | Col 23 set to `Booked`, Col 15=`12814`, Col 17=`06:10`. |
| **T-07** | `Departed` | "Status for TRP-2026-11-XXX updated to 'In Transit'. Thank you!" | Status changes to `In Transit`. |
| **T-08** | `Reached` | "Status for TRP-2026-11-XXX updated to 'Reached'. Thank you!" | Status changes to `Reached`. |
| **T-09** | `Delivered` | "Status for TRP-2026-11-XXX updated to 'Delivered'. Thank you!" | Status changes to `Delivered`. |
| **T-10** | `Can't go emergency` | "Understood. Trip marked as 'Needs reassignment'. Coordinator alerted." | `Status=Needs reassignment`, coordinator alerted. |

---

## 5-Line Plain-Language Fairness Note for Staff

> 1. Every staff member takes their turn based on total duty points for the month.  
> 2. Harder or longer routes count for more points (Kolkata = 1.0, Haldia = 1.2, Port/Dock = 1.3).  
> 3. The person with the lowest points who is not on leave or traveling gets the next trip.  
> 4. If someone is away, the system skips them fairly without losing their turn later.  
> 5. Points balance out every month so everyone shares travel work equally.
