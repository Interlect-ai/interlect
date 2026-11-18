/**
 * "Interlect bliver bygget om": shown for every request while MAINTENANCE_MODE=1 (set only in
 * Vercel's Production environment until release 1 of the redesign). The whole app, its server
 * functions and the analysis queue are paused, so the old code never touches the database
 * while the new data model is migrated.
 */
export function isMaintenanceMode(): boolean {
  return process.env["MAINTENANCE_MODE"] === "1";
}

export function renderMaintenancePage(): string {
  return `<!doctype html>
<html lang="da">
  <head>
    <meta charset="utf-8" />
    <title>Interlect bliver bygget om</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&display=swap" />
    <style>
      :root { color-scheme: light dark; --bg: #f4f2ee; --card: rgba(255,255,255,.86); --ink: #17151c; --ink-3: #5f5b66; --ink-4: #8d8994; }
      @media (prefers-color-scheme: dark) { :root { --bg: #141217; --card: rgba(30,28,34,.86); --ink: #f4f2ee; --ink-3: #b3aeb9; --ink-4: #8d8994; } }
      * { box-sizing: border-box; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 32px 20px; background: radial-gradient(60% 60% at 20% 20%, rgba(120,132,220,.18), transparent 70%), radial-gradient(50% 60% at 85% 70%, rgba(190,150,220,.16), transparent 70%), var(--bg); color: var(--ink); font: 15px/1.55 Geist, ui-sans-serif, system-ui, -apple-system, sans-serif; -webkit-font-smoothing: antialiased; }
      main { width: 100%; max-width: 420px; display: flex; flex-direction: column; gap: 18px; }
      .brand { display: flex; align-items: center; justify-content: center; gap: 10px; font-size: 20px; font-weight: 600; letter-spacing: -0.02em; }
      .brand span { color: var(--ink-4); }
      .card { padding: 30px 28px 26px; border-radius: 28px; background: var(--card); backdrop-filter: blur(20px) saturate(1.2); -webkit-backdrop-filter: blur(20px) saturate(1.2); box-shadow: 0 1px 2px rgba(23,21,28,.05), 0 30px 80px -30px rgba(23,21,28,.3); }
      h1 { margin: 0 0 8px; font-size: 28px; line-height: 1.15; font-weight: 600; letter-spacing: -0.022em; }
      p { margin: 0; color: var(--ink-3); }
    </style>
  </head>
  <body>
    <main>
      <div class="brand">
        <svg viewBox="0 0 32 32" width="26" height="26" aria-hidden="true"><path d="M7 6 H15 L11 30 H3 Z" fill="#FF5C3A"></path><path d="M19 2 H27 L23 26 H15 Z" fill="#FF5C3A"></path></svg>
        <div>Interlect<span>.ai</span></div>
      </div>
      <div class="card">
        <h1>Interlect bliver bygget om</h1>
        <p>Vi bygger en ny version af Interlect. Jeres cases, analyser og dokumenter er gemt og kommer med over. Vi åbner igen, så snart den nye version er klar.</p>
      </div>
    </main>
  </body>
</html>`;
}
