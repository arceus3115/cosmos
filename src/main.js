// Keep these side-effect imports ordered: the API client and app read the
// fallback graph assigned by data.js during module evaluation.
import "../data.js";
import "../api-client.js";
import "../app.js";

if (import.meta.env.DEV) {
  const addRecord = document.createElement("a");
  addRecord.className = "add-record-link";
  addRecord.href = "/tools/record-editor/";
  addRecord.textContent = "+ Add a record";
  document.querySelector(".top-actions").prepend(addRecord);
}
