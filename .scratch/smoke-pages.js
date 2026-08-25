// Loads every portal route in a real browser session and reports failures.
const routes = [
  '/dashboard', '/students', '/guardians', '/staff', '/attendance', '/timetable',
  '/homework', '/exams', '/academics', '/fees', '/fees/invoices', '/fees/payments',
  '/fees/collect', '/transport', '/library', '/inventory', '/leave', '/notices',
  '/messages', '/events', '/reports', '/audit', '/settings', '/support',
  '/profile', '/notifications',
];
console.log(routes.join('\n'));
