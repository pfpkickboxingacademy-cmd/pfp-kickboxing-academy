function layout({ title, active, flash, body }) {
  const nav = [
    ["/signup", "Sign Up"],
    ["/portal", "Parent Portal"],
    ["/admin", "Admin"],
  ];
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title} · PFP Kickboxing Academy</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Anton&family=Barlow:wght@400;500;600;700;800&family=JetBrains+Mono:wght@600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/styles.css">
<link rel="manifest" href="/manifest.json">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<meta name="theme-color" content="#061e63">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<script src="/app.js" defer></script>
<script defer src="https://cdn.vercel-insights.com/v1/script.js"></script>
</head>
<body>
<div class="topbar">
  <div class="brand">PFP <span style="color:var(--red)">Kickboxing</span> Academy</div>
  <nav>
    ${nav.map(([href, label]) => `<a href="${href}" style="${active === href ? "color:var(--white);" : ""}">${label}</a>`).join("")}
  </nav>
</div>
<div class="wrap">
  ${flash ? `<div class="flash${flash.error ? " error" : ""}">${flash.message}</div>` : ""}
  ${body}
</div>
</body>
</html>`;
}

module.exports = { layout };
