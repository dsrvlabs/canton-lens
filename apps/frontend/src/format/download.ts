// Handing bytes to the browser as a file. The bytes themselves are built in packages/core, which has
// no browser to hand them to; this is the two lines that need one.
//
// Nothing leaves the machine. The file is assembled from the rows already on the screen and saved
// locally — no request is made, so the export cannot show more than the participant already showed
// this viewer. That is worth stating because an "export" is usually where data starts travelling.

// Excel's type for `.xlsx`. A generic octet-stream also downloads, but then the operating system has
// no idea what the file is and offers nothing to open it with.
const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export function downloadFile(bytes: Uint8Array, fileName: string, type = XLSX_TYPE): void {
  // The BlobPart type wants an ArrayBuffer rather than the view; `slice` also detaches the copy from
  // core's buffer, so a caller reusing it cannot change the file after it is handed over.
  const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  // Not appended to the document: a click on a detached anchor still starts the download, and an
  // element added to the page is one that can be seen, styled by a stylesheet, or left behind.
  anchor.click();
  // **Revoked, but not in the same tick.** The download reads the blob asynchronously, and revoking
  // immediately has been observed to cancel it. One turn of the event loop is enough and leaks
  // nothing beyond it.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
