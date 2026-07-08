# Accessibility Experience Survey

This project is a lightweight, self-hosted Node.js survey application designed specifically for accessibility surveys. It serves the survey pages, handles form submissions, saves responses locally as a backup, and forwards them automatically to a **Google Sheet**.

---

## Features
- **Zero Front-end Dependencies:** Runs pure semantic HTML and vanilla CSS/JS.
- **Node.js Native Backend:** Zero-dependency server running on standard Node 18+.
- **Google Sheets Integration:** Automatically forwards all incoming submissions to a Google Sheet using Google Apps Script (fully free, no API keys or Google Cloud console setup required).
- **Local Fallback Storage:** Appends submissions locally to `data/responses.ndjson` so you never lose data, even if the sheet is unreachable.
- **CSV Data Export:** Provides a downloadable UTF-8 CSV via `/admin/responses.csv?token=<ADMIN_TOKEN>`.

---

## 1. Google Sheets Integration Setup (Free)

Follow these steps to pipe your survey submissions directly into a Google Sheet:

1. **Create a Google Sheet:** Create a new empty Google Sheet.
2. **Open Apps Script:** In the top menu, go to **Extensions** > **Apps Script**.
3. **Paste the Script:** Delete any default code in the editor and paste the following script:

```javascript
function doPost(e) {
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    var data = JSON.parse(e.postData.contents);
    
    // Exact column headers mapping to incoming survey fields
    var COLUMNS = [
      'receivedAt', 'id', 'language', 'name', 'email', 'follow-up', 'age',
      'country', 'sight-today', 'sight-birth', 'vision-change', 'screenreader',
      'screenreader-other', 'devices', 'devices-other', 'learning',
      'learning-other', 'comfort-time', 'difficulty', 'works-well', 'barriers',
      'barriers-other', 'harder', 'leave-frequency', 'unusable',
      'accessible-sites', 'ideal', 'ideal-other', 'redesign', 'redesign-other',
      'useful', 'would-use', 'ai-concerns', 'ai-concerns-other', 'life-change',
      'final-thoughts'
    ];
    
    // Auto-create headers in sheet if it's completely empty
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(COLUMNS);
    }
    
    // Extract survey field values matching column order
    var row = COLUMNS.map(function(col) {
      var val = data[col];
      if (val === undefined || val === null) return '';
      if (Array.isArray(val)) return val.join('; '); // Join multiple selections with a semicolon
      return val;
    });
    
    sheet.appendRow(row);
    return ContentService.createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// Handles Google's redirect validation cleanly
function doGet(e) {
  return ContentService.createTextOutput("Active");
}
```

4. **Deploy as a Web App:**
   - Click the **Deploy** button in the top right and select **New deployment**.
   - Click the gear icon next to "Select type" and choose **Web app**.
   - Set the options as follows:
     - **Description:** `Survey Forwarder`
     - **Execute as:** `Me (your-email@gmail.com)`
     - **Who has access:** `Anyone` (this lets your Node server call it without complex OAuth login).
   - Click **Deploy**.
   - Authorize access to your Google Account when prompted.
5. **Copy the Web App URL:** Once deployment is complete, copy the **Web App URL** (it looks like `https://script.google.com/macros/s/.../exec`). You will use this in your environment variables.

---

## 2. Environment Variables

Configure these environment variables on your hosting provider or in a local `.env` file:

| Variable | Description | Example |
| :--- | :--- | :--- |
| `PORT` | The port the Node server listens on (defaults to `8642`). | `3000` |
| `ADMIN_TOKEN` | Secure token used to download the local CSV backup. If empty, export is restricted to `localhost`. | `mySuperSecretToken123` |
| `GOOGLE_SHEETS_URL` | The Web App URL generated from the Google Apps Script setup. | `https://script.google.com/macros/s/.../exec` |

---

## 3. Local Development

1. **Install dependencies:** None needed!
2. **Start the server:**
   ```bash
   npm start
   ```
   Or specify variables inline:
   ```bash
   PORT=3000 ADMIN_TOKEN=secret GOOGLE_SHEETS_URL=https://... npm start
   ```
3. Open `http://localhost:3000` to view the survey chooser page.
4. **Download the local CSV backup:** Visit `http://localhost:3000/admin/responses.csv?token=secret`.

---

## 4. Production Hosting Options

Since the Google Sheet acts as your primary database, you can host the app almost anywhere. Here are the easiest ways:

### Option A: Railway (Recommended - Fastest & Easiest)
Railway detects the `package.json` automatically and starts the application instantly.
1. Connect your Git repository to Railway.
2. In Railway, click **New Project** > **Deploy from GitHub repo**.
3. Go to the **Variables** tab of the service and add:
   - `ADMIN_TOKEN`: `<your-random-token>`
   - `GOOGLE_SHEETS_URL`: `<your-google-script-url>`
4. Railway will automatically handle setting the `PORT`.
5. *(Optional)* If you want the local backup NDJSON file to survive server redeployments, go to **Settings** > **Volumes** and mount a disk at `/app/data`.

### Option B: Render
1. Create a free account on [Render](https://render.com/).
2. Click **New** > **Web Service** and link your Git repository.
3. Choose the runtime **Node** and set the build command to empty and start command to `npm start`.
4. In the **Environment** section, add your `ADMIN_TOKEN` and `GOOGLE_SHEETS_URL`.
5. *(Optional)* Add a Disk (under the **Advanced** section or **Disks** tab) mounted at `/app/data` to persist the local backup file.

### Option C: Fly.io
1. Install `flyctl` and log in.
2. Initialize the app in the directory:
   ```bash
   fly launch
   ```
3. Set your environment variables:
   ```bash
   fly secrets set ADMIN_TOKEN="your-token" GOOGLE_SHEETS_URL="your-sheet-url"
   ```
4. *(Optional)* Add a persistent volume:
   ```bash
   fly volumes create survey_data --size 1
   ```
   Then add this mounts block to your generated `fly.toml`:
   ```toml
   [[mounts]]
     source = "survey_data"
     destination = "/app/data"
   ```
5. Deploy:
   ```bash
   fly deploy
   ```

### Option D: Virtual Private Server (VPS) / Self-Hosted
If you have a Linux VPS (DigitalOcean, Linode, AWS EC2, etc.):
1. Install Node.js (v18+) and PM2 (Process Manager).
2. Clone the repository to your server.
3. Create a `.env` file in the folder:
   ```env
   PORT=8642
   ADMIN_TOKEN=yourSecretToken
   GOOGLE_SHEETS_URL=https://...
   ```
4. Run the app with PM2:
   ```bash
   pm2 start server.js --name "blind-survey"
   ```
5. Configure Nginx as a reverse proxy pointing to `http://localhost:8642` and set up an SSL certificate with Certbot/Let's Encrypt.
