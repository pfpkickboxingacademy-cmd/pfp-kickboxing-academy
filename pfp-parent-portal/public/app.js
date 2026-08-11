// Registers the service worker (makes the app installable) and exposes
// window.PFP.enablePush(buttonEl) for the "Enable Push Notifications"
// button on the parent dashboard. Relies on the logged-in session cookie —
// no email needs to be passed from the page.

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((err) => console.warn("SW registration failed:", err));
  });
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

async function enablePush(buttonEl) {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    alert("Push notifications aren't supported in this browser.");
    return;
  }
  try {
    if (buttonEl) buttonEl.textContent = "Enabling...";
    const keyRes = await fetch("/push/public-key").then((r) => r.json());
    if (!keyRes.publicKey) {
      alert("Push isn't configured on the server yet (no VAPID keys set) — this is expected in dry-run mode.");
      if (buttonEl) buttonEl.textContent = "Enable Push Notifications";
      return;
    }
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(keyRes.publicKey),
    });
    const res = await fetch("/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ subscription: sub.toJSON() }),
    });
    if (!res.ok) throw new Error((await res.json()).error || "Subscribe failed");
    if (buttonEl) buttonEl.textContent = "Push Notifications Enabled";
  } catch (err) {
    console.error(err);
    alert("Couldn't enable push notifications: " + err.message);
    if (buttonEl) buttonEl.textContent = "Enable Push Notifications";
  }
}

window.PFP = { enablePush };
