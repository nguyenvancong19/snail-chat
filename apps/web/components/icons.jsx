const paths = {
  sidebar:'<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M9 4v16"/>',
  shop:'<path d="M4 11v9h16v-9M3 10l2-6h14l2 6a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0Zm7 10v-5h4v5"/>',
  book:'<path d="M12 6C9 4 6 4 3 5v14c3-1 6-1 9 1 3-2 6-2 9-1V5c-3-1-6-1-9 1Zm0 0v14"/>',
  package:'<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Zm-8 4.5 8 4.5 8-4.5M12 12v9M8 5.3l8 4.4"/>',
  tag:'<path d="M3 4h8l10 10-7 7L3 11V4Z"/><circle cx="7.5" cy="8.5" r="1"/>',
  users:'<circle cx="9" cy="8" r="3"/><path d="M3 20v-2a5 5 0 0 1 5-5h2a5 5 0 0 1 5 5v2m1-15a3 3 0 0 1 0 6m2 2a4 4 0 0 1 3 4v3"/>',
  alert:'<path d="M10.3 4.8 3 18a1 1 0 0 0 .9 1.5h16.2A1 1 0 0 0 21 18L13.7 4.8a2 2 0 0 0-3.4 0ZM12 9v4m0 3h.01"/>',
  document:'<path d="M6 4h8l4 4v12H6zM14 4v5h4M9 13h6m-6 3h6"/>',
  chevron:'<path d="m6 9 6 6 6-6"/>',
  settings:'<circle cx="12" cy="12" r="3"/><path d="m10 3-1 3-3 1-3 3v4l3 3 3 1 1 3h4l1-3 3-1 3-3v-4l-3-3-3-1-1-3z"/>',
  switch:'<path d="M4 7h15l-4-4m5 14H5l4 4"/>',
  logout:'<path d="M10 4H4v16h6m5-12 4 4-4 4m4-4H9"/>',

  chart:'<path d="M3 3v18h18M8 16v-4m5 4V7m5 9v-6"/>', eye:'<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z"/><circle cx="12" cy="12" r="2.5"/>',
  logo:'<rect x="3" y="4" width="18" height="16" rx="4"/><path d="m10 8 5 4-5 4z"/>',
  grid:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>',
  channels:'<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4m-4-10h.01M12 11h.01M16 11h.01"/>',
  film:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4m-4 6h4m10-6h4m-4 6h4"/>',
  calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18m-13 5h2m4 0h2"/>',
  chat:'<path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5 9 9 0 0 1-4-.9L4 21l1.6-4A8.5 8.5 0 1 1 21 11.5Z"/><path d="M9 12h6"/>',
  bot:'<rect x="4" y="7" width="16" height="13" rx="3"/><path d="M12 3v4M2 12v3m20-3v3M9 12h.01M15 12h.01M9 16h6"/>',
  user:'<circle cx="12" cy="8" r="3"/><path d="M5 20v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2"/>',
  fb:'<path d="M14 21v-8h3l.5-3H14V8c0-1 .4-1.5 1.6-1.5H18V3.4c-.5-.2-1.7-.4-3-.4-2.9 0-4.5 1.7-4.5 4.7V10H8v3h2.5v8z"/>',
  ig:'<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><path d="M17.5 6.5h.01"/>',
  plus:'<path d="M12 5v14M5 12h14"/>', arrow:'<path d="M5 12h14m-6-6 6 6-6 6"/>', left:'<path d="m15 5-7 7 7 7"/>', right:'<path d="m9 5 7 7-7 7"/>',
  check:'<path d="m5 12 5 5L19 8"/>', clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', bell:'<path d="M18 8a6 6 0 0 0-12 0c0 7-2 7-2 9h16c0-2-2-2-2-9m-8 12h4"/>',
  edit:'<path d="m4 20 4-.5L20 7l-3-3L5 16zM14 7l3 3"/>', x:'<path d="m6 6 12 12M18 6 6 18"/>', play:'<path d="m8 5 12 7-12 7z"/>',
  menu:'<path d="M4 6h16M4 12h16M4 18h16"/>', upload:'<path d="M12 16V4m-5 5 5-5 5 5M4 16v4h16v-4"/>', lock:'<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  send:'<path d="m3 4 18 8-18 8 3-8zm3 8h15"/>', link:'<path d="M10 13a4 4 0 0 0 6 .5l4-4a4 4 0 0 0-6-6l-2 2m2 6a4 4 0 0 0-6-.5l-4 4a4 4 0 0 0 6 6l2-2"/>'
};

export function Icon({ name }) {
  return <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" dangerouslySetInnerHTML={{__html:paths[name] ?? ''}} />;
}
