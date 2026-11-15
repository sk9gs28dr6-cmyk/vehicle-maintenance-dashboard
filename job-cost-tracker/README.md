# Job Cost Tracker

Budget-versus-actual tracking for construction projects. A Google Apps Script web app with one Google Sheet as its database.

## Install (about 5 minutes)

1. Create a new, empty Google Sheet. Name it anything, for example "Job Cost Tracker".
2. In the Sheet, open **Extensions > Apps Script**.
3. Create these files in the script editor and paste in the contents of the matching file from this folder:

   | In the editor | Type | Paste from |
   | --- | --- | --- |
   | `Code` | Script | `Code.gs` |
   | `Data` | Script | `Data.gs` |
   | `Setup` | Script | `Setup.gs` |
   | `Index` | HTML | `Index.html` |
   | `Styles` | HTML | `Styles.html` |
   | `App` | HTML | `App.html` |

   Names must match exactly, including capitals. Do not copy the `dev` folder.
4. Click **Deploy > New deployment**, choose type **Web app**, set *Execute as* **Me** and *Who has access* **Only myself**, then **Deploy**. Approve the permissions when asked.
5. Open the web app URL and bookmark it. The first load creates the tabs and the residential template.

To update later, paste the changed files and use **Deploy > Manage deployments > Edit > New version**.

## Using it

- **New project** copies the residential template (20 categories, 93 line items). Type budgets on the Budget tab, then **Finalize budget**. That locks the original budget and sets the contract price to the budget including your fee.
- **Add cost** (or press `N`) needs a line item, an amount and a vendor. Click any line on the Budget tab to see the entries behind it.
- Tick a line **done** when no more costs are coming. Its forecast then equals what was spent.
- Budget or price changes after finalizing go through **Change orders**.
- The **Admin Fee** line holds your own invoices for general contractor services. It is profit, not cost.
- **Lot Purchase** counts as cost but is left out of percent complete.
- **Settings** has the template editor (paste the commercial template there when it is ready), CSV export, weekly backup and a demo project.

## Files

| File | Role |
| --- | --- |
| `Code.gs` | Web app entry point and the functions the page calls |
| `Data.gs` | Reads and writes the Sheet tabs, with validation and locking |
| `Setup.gs` | Creates tabs, residential template, demo project, weekly backup |
| `Index.html` | Page shell |
| `Styles.html` | Style guide plus this app's additions |
| `App.html` | Client code: calculations, screens, dialogs |
| `dev/` | Local preview and tests. Not deployed. |

## Local preview and tests

Requires Node and Playwright. Data is held in memory and resets on restart.

```
node dev/server.js          # preview at http://localhost:8765
node dev/test-server.js     # data layer checks
node dev/e2e.js             # browser checks (server must be running)
```
