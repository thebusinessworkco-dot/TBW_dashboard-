/* Demo data for Vertix. The first five activities, the wallets, the chart
   and the stat tiles match the reference design exactly. */

export const USER = {
  first: 'Code XR',
  name: 'Code XR',
  email: 'hello@codexr.studio',
  phone: '+880 1712 345 678',
  location: 'Dhaka, Bangladesh',
  memberSince: 'March 2021',
}

export const CURRENCIES = {
  USD: { code: 'USD', symbol: '$', rate: 1, flag: 'us', name: 'US Dollar' },
  EUR: { code: 'EUR', symbol: '€', rate: 0.92, flag: 'de', name: 'Euro' },
  GBP: { code: 'GBP', symbol: '£', rate: 0.79, flag: 'gb', name: 'British Pound' },
}

export const BALANCE_USD = 689372

export const WALLETS = [
  { id: 'usd', code: 'USD', flag: 'us', symbol: '$', amount: 22678, limit: '$10k', status: 'active' },
  { id: 'eur', code: 'EUR', flag: 'de', symbol: '€', amount: 18345, limit: '€8k', status: 'active' },
  { id: 'gbp', code: 'GBP', flag: 'gb', symbol: '£', amount: 15000, limit: '£7.5k', status: 'inactive' },
  { id: 'jpy', code: 'JPY', flag: 'jp', symbol: '¥', amount: 125000, limit: '¥1.2m', status: 'active' },
  { id: 'cad', code: 'CAD', flag: 'ca', symbol: 'C$', amount: 9420, limit: 'C$6k', status: 'active' },
  { id: 'aed', code: 'AED', flag: 'ae', symbol: 'AED ', amount: 36800, limit: 'AED 20k', status: 'inactive' },
]

export const STATS = [
  { id: 'earnings', label: 'Total Earnings', value: 950, delta: 7, icon: 'wallet' },
  { id: 'spending', label: 'Total Spending', value: 700, delta: -5, icon: 'bag' },
  { id: 'income', label: 'Total Income', value: 1050, delta: 8, icon: 'coins' },
  { id: 'revenue', label: 'Total Revenue', value: 850, delta: 4, icon: 'sack' },
]

/** Profit and loss per month, in thousands. */
export const PNL = [
  { m: 'Jan', loss: 20, profit: 15.5 },
  { m: 'Feb', loss: 15, profit: 26 },
  { m: 'Mar', loss: 11, profit: 23 },
  { m: 'Apr', loss: 18, profit: 20 },
  { m: 'May', loss: 14.5, profit: 27.5 },
  { m: 'Jun', loss: 26, profit: 22 },
  { m: 'Jul', loss: 18.5, profit: 21 },
  { m: 'Aug', loss: 12, profit: 20 },
]

export const SPEND = { spent: 1400, limit: 5500 }

export const CARDS = [
  {
    id: 'k1',
    skin: 'onyx',
    holder: 'Code XR',
    number: '5412 7534 9821 6782',
    exp: '09/29',
    cvv: '611',
    status: 'Active',
    frozen: false,
    controls: { online: true, contactless: true, atm: true, abroad: false },
  },
  {
    id: 'k2',
    skin: 'ember',
    holder: 'Code XR',
    number: '4921 0087 3315 4356',
    exp: '03/28',
    cvv: '208',
    status: 'Active',
    frozen: false,
    controls: { online: true, contactless: true, atm: false, abroad: true },
  },
]

export const ACTIVITIES = [
  { key: 'a1', id: 'INV_000076', title: 'Mobile App Purchase', logo: 'appstore', price: 25500, status: 'Completed', date: '2026-04-17T15:45', dir: 'out', category: 'Software' },
  { key: 'a2', id: 'INV_000075', title: 'Hotel Booking', logo: 'hotel', price: 32750, status: 'Pending', date: '2026-04-15T11:30', dir: 'out', category: 'Travel' },
  { key: 'a3', id: 'INV_000074', title: 'Flight Ticket Booking', logo: 'flight', price: 40200, status: 'Completed', date: '2026-04-15T12:00', dir: 'out', category: 'Travel' },
  { key: 'a4', id: 'INV_000073', title: 'Grocery Purchase', logo: 'grocery', price: 50200, status: 'In Progress', date: '2026-04-14T21:15', dir: 'out', category: 'Shopping' },
  { key: 'a5', id: 'INV_000073', title: 'Software License', logo: 'software', price: 15900, status: 'Completed', date: '2026-04-10T06:00', dir: 'out', category: 'Software' },
  { key: 'a6', id: 'INV_000072', title: 'Salary — Orbit Labs', logo: 'salary', price: 84000, status: 'Completed', date: '2026-04-08T09:00', dir: 'in', category: 'Income' },
  { key: 'a7', id: 'INV_000071', title: 'Streaming Subscription', logo: 'stream', price: 1599, status: 'Completed', date: '2026-04-07T08:20', dir: 'out', category: 'Bills' },
  { key: 'a8', id: 'INV_000070', title: 'Airport Ride', logo: 'ride', price: 2850, status: 'Completed', date: '2026-04-06T19:40', dir: 'out', category: 'Travel' },
  { key: 'a9', id: 'INV_000069', title: 'Electricity Bill', logo: 'utility', price: 8600, status: 'Pending', date: '2026-04-05T10:10', dir: 'out', category: 'Bills' },
  { key: 'a10', id: 'INV_000068', title: 'Client Payment — Pixel Studio', logo: 'transfer', price: 52000, status: 'Completed', date: '2026-04-04T14:25', dir: 'in', category: 'Income' },
  { key: 'a11', id: 'INV_000067', title: 'Coffee Beans Order', logo: 'coffee', price: 1240, status: 'Completed', date: '2026-04-03T07:55', dir: 'out', category: 'Food' },
  { key: 'a12', id: 'INV_000066', title: 'Gym Membership', logo: 'gym', price: 4500, status: 'In Progress', date: '2026-04-02T18:30', dir: 'out', category: 'Health' },
  { key: 'a13', id: 'INV_000065', title: 'Design Tools Renewal', logo: 'software', price: 9900, status: 'Completed', date: '2026-03-30T11:00', dir: 'out', category: 'Software' },
  { key: 'a14', id: 'INV_000064', title: 'Refund — Hotel Booking', logo: 'hotel', price: 6400, status: 'Completed', date: '2026-03-28T16:45', dir: 'in', category: 'Travel' },
  { key: 'a15', id: 'INV_000063', title: 'Weekly Groceries', logo: 'grocery', price: 3870, status: 'Completed', date: '2026-03-27T20:05', dir: 'out', category: 'Shopping' },
  { key: 'a16', id: 'INV_000062', title: 'Office Rent', logo: 'utility', price: 18000, status: 'Pending', date: '2026-03-25T09:30', dir: 'out', category: 'Bills' },
  { key: 'a17', id: 'INV_000061', title: 'App Store Payout', logo: 'appstore', price: 12750, status: 'Completed', date: '2026-03-22T13:15', dir: 'in', category: 'Income' },
  { key: 'a18', id: 'INV_000060', title: 'Weekend Flight', logo: 'flight', price: 21400, status: 'Completed', date: '2026-03-19T06:40', dir: 'out', category: 'Travel' },
]

export const NOTIFICATIONS = [
  { id: 'n1', icon: 'arrowDown', tone: 'green', title: 'You received $84,000.00', body: 'Salary from Orbit Labs landed in USD wallet', time: '2m ago', unread: true },
  { id: 'n2', icon: 'clock', tone: 'amber', title: 'Hotel Booking is pending', body: '$32,750.00 is waiting for confirmation', time: '1h ago', unread: true },
  { id: 'n3', icon: 'card', tone: 'accent', title: 'Card •••• 4356 used online', body: 'Software License · $15,900.00', time: '5h ago', unread: true },
  { id: 'n4', icon: 'chart', tone: 'blue', title: 'Your April report is ready', body: 'Income is up 8% from last month', time: 'Yesterday', unread: false },
  { id: 'n5', icon: 'shield', tone: 'muted', title: 'New sign-in from iPhone 15 Pro', body: 'Dhaka, Bangladesh', time: '2 days ago', unread: false },
]

export const CONTACTS = [
  { id: 'c1', name: 'Ayesha Khan', handle: '@ayesha.k', bank: 'Northstar Bank •• 4410', kind: 'person', fav: true, last: 250, lastDate: '12 Apr', hue: 14 },
  { id: 'c2', name: 'Rafiq Ahmed', handle: '@rafiq', bank: 'Harbor Savings •• 1189', kind: 'person', fav: true, last: 1200, lastDate: '9 Apr', hue: 210 },
  { id: 'c3', name: 'Pixel Studio', handle: 'pixelstudio.co', bank: 'Meridian Credit •• 7731', kind: 'business', fav: true, last: 5000, lastDate: '4 Apr', hue: 268 },
  { id: 'c4', name: 'Nadia Islam', handle: '@nadia.i', bank: 'Northstar Bank •• 9012', kind: 'person', fav: false, last: 80, lastDate: '2 Apr', hue: 330 },
  { id: 'c5', name: 'Green Leaf Café', handle: 'greenleaf.cafe', bank: 'Harbor Savings •• 3302', kind: 'business', fav: false, last: 64, lastDate: '1 Apr', hue: 140 },
  { id: 'c6', name: 'Tanvir Hasan', handle: '@tanvir', bank: 'Meridian Credit •• 5548', kind: 'person', fav: true, last: 450, lastDate: '29 Mar', hue: 38 },
  { id: 'c7', name: 'Northwind Hosting', handle: 'northwind.host', bank: 'Atlas Bank •• 2207', kind: 'business', fav: false, last: 129, lastDate: '25 Mar', hue: 190 },
  { id: 'c8', name: 'Sara Williams', handle: '@sara.w', bank: 'Atlas Bank •• 6620', kind: 'person', fav: false, last: 300, lastDate: '21 Mar', hue: 0 },
  { id: 'c9', name: 'Orbit Labs', handle: 'orbitlabs.io', bank: 'Northstar Bank •• 0045', kind: 'business', fav: false, last: 0, lastDate: '—', hue: 245 },
  { id: 'c10', name: 'Mehedi Hasan', handle: '@mehedi', bank: 'Harbor Savings •• 8876', kind: 'person', fav: false, last: 150, lastDate: '15 Mar', hue: 95 },
]

export const CONVERSATIONS = [
  {
    id: 'support',
    name: 'Vertix Support',
    hue: 16,
    brand: true,
    online: true,
    unread: 2,
    messages: [
      { from: 'them', text: 'Hi Code XR 👋 Your GBP wallet was set to inactive after 90 days without activity.', time: '09:12 AM' },
      { from: 'them', text: 'You can reactivate it from the Wallets panel on your dashboard any time.', time: '09:12 AM' },
    ],
  },
  {
    id: 'c1',
    name: 'Ayesha Khan',
    hue: 14,
    online: true,
    unread: 1,
    messages: [
      { from: 'them', text: 'Got the $250, thank you!', time: 'Yesterday' },
      { from: 'me', text: 'Anytime. Dinner on Friday still on?', time: 'Yesterday' },
      { from: 'them', text: 'Yes! I booked the table for 8 PM 🍜', time: '08:41 AM' },
    ],
  },
  {
    id: 'c3',
    name: 'Pixel Studio',
    hue: 268,
    online: false,
    unread: 0,
    messages: [
      { from: 'them', text: 'Invoice INV-2026-041 has been settled. Thanks for the quick payment.', time: 'Mon' },
      { from: 'me', text: 'Great work on the brand refresh. Sending the next brief this week.', time: 'Mon' },
    ],
  },
  {
    id: 'team',
    name: 'Finance Team',
    hue: 210,
    online: true,
    unread: 0,
    messages: [
      { from: 'them', text: 'Q1 reconciliation is done. Two items flagged for review.', time: 'Sun' },
      { from: 'me', text: 'Thanks — I will check them before Wednesday.', time: 'Sun' },
    ],
  },
  {
    id: 'c8',
    name: 'Sara Williams',
    hue: 0,
    online: false,
    unread: 0,
    messages: [{ from: 'them', text: 'Could you request the $300 again? The link expired.', time: '12 Apr' }],
  },
]

export const AUTO_REPLIES = [
  'Got it, thanks!',
  'Perfect — I will take a look and get back to you shortly.',
  'Sounds good 👍',
  'Thanks for the update. Anything else I can help with?',
  'Noted. I will confirm once it is done.',
]

export const INVOICES = [
  { id: 'INV-2026-046', client: 'Bluebird Travel', email: 'accounts@bluebird.travel', issued: '2026-04-16', due: '2026-04-30', status: 'pending', hue: 200, items: [{ d: 'Campaign landing pages', q: 3, p: 1200 }, { d: 'Analytics setup', q: 1, p: 650 }] },
  { id: 'INV-2026-045', client: 'Orbit Labs', email: 'ap@orbitlabs.io', issued: '2026-04-12', due: '2026-04-26', status: 'pending', hue: 245, items: [{ d: 'Dashboard UI design', q: 1, p: 6400 }, { d: 'Design system audit', q: 1, p: 1800 }] },
  { id: 'INV-2026-044', client: 'Green Leaf Café', email: 'hello@greenleaf.cafe', issued: '2026-03-28', due: '2026-04-11', status: 'overdue', hue: 140, items: [{ d: 'Menu redesign', q: 1, p: 900 }, { d: 'Print files', q: 2, p: 120 }] },
  { id: 'INV-2026-043', client: 'Northwind Hosting', email: 'billing@northwind.host', issued: '2026-03-20', due: '2026-04-03', status: 'paid', hue: 190, items: [{ d: 'Status page design', q: 1, p: 2200 }] },
  { id: 'INV-2026-042', client: 'Kite & Co.', email: 'finance@kite.co', issued: '2026-03-14', due: '2026-03-28', status: 'overdue', hue: 38, items: [{ d: 'Pitch deck', q: 1, p: 3400 }, { d: 'Icon set', q: 24, p: 35 }] },
  { id: 'INV-2026-041', client: 'Pixel Studio', email: 'billing@pixelstudio.co', issued: '2026-03-02', due: '2026-03-16', status: 'paid', hue: 268, items: [{ d: 'Brand identity design', q: 1, p: 3200 }, { d: 'Landing page', q: 1, p: 1800 }] },
]

export const EVENTS = [
  { id: 'e1', date: '2026-04-03', time: '09:00', title: 'Rent payment', amount: -1800, kind: 'bill' },
  { id: 'e2', date: '2026-04-07', time: '08:20', title: 'Streaming renewal', amount: -15.99, kind: 'subscription' },
  { id: 'e3', date: '2026-04-08', time: '09:00', title: 'Salary deposit', amount: 8400, kind: 'income' },
  { id: 'e4', date: '2026-04-10', time: '06:00', title: 'Software license', amount: -15900, kind: 'bill' },
  { id: 'e5', date: '2026-04-14', time: '21:15', title: 'Grocery delivery', amount: -502, kind: 'reminder' },
  { id: 'e6', date: '2026-04-15', time: '11:30', title: 'Hotel balance due', amount: -32750, kind: 'transfer' },
  { id: 'e7', date: '2026-04-15', time: '12:00', title: 'Flight to Dubai', amount: -40200, kind: 'travel' },
  { id: 'e8', date: '2026-04-17', time: '15:45', title: 'App purchase settles', amount: -25500, kind: 'bill' },
  { id: 'e9', date: '2026-04-17', time: '18:00', title: 'Review Q1 statement', amount: null, kind: 'reminder' },
  { id: 'e10', date: '2026-04-20', time: '10:00', title: 'Electricity bill', amount: -86, kind: 'bill' },
  { id: 'e11', date: '2026-04-22', time: '09:00', title: 'Move $500 to savings', amount: -500, kind: 'transfer' },
  { id: 'e12', date: '2026-04-25', time: '12:00', title: 'Orbit Labs invoice due', amount: 8200, kind: 'income' },
  { id: 'e13', date: '2026-04-28', time: '07:00', title: 'Gym membership', amount: -45, kind: 'subscription' },
  { id: 'e14', date: '2026-04-30', time: '17:00', title: 'Card statement closes', amount: null, kind: 'reminder' },
  { id: 'e15', date: '2026-05-03', time: '09:00', title: 'Rent payment', amount: -1800, kind: 'bill' },
  { id: 'e16', date: '2026-05-08', time: '09:00', title: 'Salary deposit', amount: 8400, kind: 'income' },
  { id: 'e17', date: '2026-05-12', time: '14:00', title: 'Trip to Bali — deposit', amount: -1200, kind: 'travel' },
]

export const GOALS = [
  { id: 'g1', name: 'New MacBook Pro', icon: 'laptop', saved: 1850, target: 2499, due: 'Jun 2026', hue: 16 },
  { id: 'g2', name: 'Trip to Bali', icon: 'plane', saved: 3200, target: 5000, due: 'Aug 2026', hue: 200 },
  { id: 'g3', name: 'Emergency fund', icon: 'shield', saved: 9400, target: 15000, due: 'Dec 2026', hue: 145 },
  { id: 'g4', name: 'New car', icon: 'car', saved: 6200, target: 24000, due: 'Mar 2027', hue: 265 },
  { id: 'g5', name: "Mum's birthday gift", icon: 'gift', saved: 480, target: 600, due: 'May 2026', hue: 335 },
]

export const SAVINGS_TREND = [
  { m: 'Nov', v: 1400 },
  { m: 'Dec', v: 2100 },
  { m: 'Jan', v: 1650 },
  { m: 'Feb', v: 2400 },
  { m: 'Mar', v: 2950 },
  { m: 'Apr', v: 3320 },
]

export const AUTOSAVE = [
  { id: 'round', label: 'Round-ups', body: 'Round every card payment up to the next dollar.', on: true },
  { id: 'payday', label: 'Payday boost', body: 'Move 10% of every salary into goals automatically.', on: true },
  { id: 'weekly', label: 'Weekly $50', body: 'A small transfer every Monday morning.', on: false },
]

export const OFFERS = [
  { id: 'o1', icon: 'plane', title: '5% back on flights', body: 'Book with any airline using your Vertix card.', ends: 'Ends 30 Apr', active: true },
  { id: 'o2', icon: 'cart', title: '2× points on groceries', body: 'Every grocery purchase earns double points.', ends: 'Ends 15 May', active: false },
  { id: 'o3', icon: 'coffee', title: 'Free coffee on Fridays', body: 'One drink on us at partner cafés every week.', ends: 'Ongoing', active: false },
  { id: 'o4', icon: 'monitor', title: '10% off software', body: 'Design, dev and productivity tools included.', ends: 'Ends 31 May', active: true },
  { id: 'o5', icon: 'car', title: '$5 off airport rides', body: 'Applies automatically to rides over $25.', ends: 'Ends 20 May', active: false },
  { id: 'o6', icon: 'bed', title: '3× points on hotels', body: 'Stay anywhere and earn triple points.', ends: 'Ends 30 Jun', active: false },
]

export const POINTS_LOG = [
  { id: 'p1', title: 'Flight Ticket Booking', pts: 1206, date: '15 Apr' },
  { id: 'p2', title: 'Grocery Purchase', pts: 1004, date: '14 Apr' },
  { id: 'p3', title: 'Redeemed — Lounge pass', pts: -2500, date: '11 Apr' },
  { id: 'p4', title: 'Software License', pts: 477, date: '10 Apr' },
  { id: 'p5', title: 'Referral bonus', pts: 1500, date: '6 Apr' },
]

export const REWARDS = [
  { id: 'r1', icon: 'plane', title: 'Airport lounge pass', cost: 2500 },
  { id: 'r2', icon: 'coffee', title: '$25 café voucher', cost: 1800 },
  { id: 'r3', icon: 'gift', title: '$50 statement credit', cost: 4500 },
  { id: 'r4', icon: 'bed', title: 'Hotel night upgrade', cost: 6000 },
]

export const BANKS = [
  { id: 'b1', name: 'Northstar Bank', mask: '•••• 2210', type: 'Checking', primary: true, hue: 220 },
  { id: 'b2', name: 'Harbor Savings', mask: '•••• 8841', type: 'Savings', primary: false, hue: 168 },
  { id: 'b3', name: 'Meridian Credit Union', mask: '•••• 5306', type: 'Business', primary: false, hue: 28 },
]

export const SESSIONS = [
  { id: 's1', device: 'MacBook Pro 14″ · Safari', icon: 'laptop', place: 'Dhaka, Bangladesh', when: 'Active now', current: true },
  { id: 's2', device: 'iPhone 15 Pro · Vertix app', icon: 'phone', place: 'Dhaka, Bangladesh', when: '2 hours ago', current: false },
  { id: 's3', device: 'iPad Air · Vertix app', icon: 'tablet', place: 'Chattogram, Bangladesh', when: 'Yesterday', current: false },
  { id: 's4', device: 'Windows PC · Chrome', icon: 'monitor', place: 'Dubai, UAE', when: '3 days ago', current: false },
]

export const REPORTS = {
  week: {
    labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    income: [4.2, 6.8, 5.1, 9.4, 7.6, 3.2, 2.4],
    expense: [3.1, 4.4, 6.2, 5.0, 8.1, 4.6, 1.9],
    categories: [
      { name: 'Travel', v: 9.6 },
      { name: 'Shopping', v: 7.2 },
      { name: 'Software', v: 5.4 },
      { name: 'Bills', v: 4.1 },
      { name: 'Food', v: 3.0 },
    ],
  },
  month: {
    labels: ['Apr 1', 'Apr 5', 'Apr 9', 'Apr 13', 'Apr 17', 'Apr 21', 'Apr 25', 'Apr 29'],
    income: [18, 52, 84, 36, 61, 44, 72, 58],
    expense: [22, 30, 41, 55, 48, 39, 46, 33],
    categories: [
      { name: 'Travel', v: 73.4 },
      { name: 'Shopping', v: 54.1 },
      { name: 'Software', v: 41.4 },
      { name: 'Bills', v: 28.2 },
      { name: 'Food', v: 12.6 },
    ],
  },
  year: {
    labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
    income: [210, 248, 232, 296, 284, 318, 302, 276, 330, 352, 341, 388],
    expense: [168, 182, 201, 214, 196, 236, 228, 204, 241, 262, 255, 290],
    categories: [
      { name: 'Travel', v: 612 },
      { name: 'Shopping', v: 488 },
      { name: 'Software', v: 402 },
      { name: 'Bills', v: 336 },
      { name: 'Food', v: 158 },
    ],
  },
}

export const STATEMENTS = [
  { id: 'st1', name: 'April 2026 statement', meta: 'Generated 17 Apr · 18 transactions' },
  { id: 'st2', name: 'Q1 2026 summary', meta: 'Jan – Mar · Profit & loss, tax overview' },
  { id: 'st3', name: 'March 2026 statement', meta: 'Generated 1 Apr · 42 transactions' },
  { id: 'st4', name: 'Tax year 2025', meta: 'Full year · ready for your accountant' },
]

export const FAQS = [
  { id: 'f1', topic: 'Payments', q: 'How long does an international transfer take?', a: 'Transfers between Vertix wallets are instant. Transfers to external banks usually arrive within 1–2 business days, depending on the receiving bank and currency.' },
  { id: 'f2', topic: 'Payments', q: 'Why is my payment showing as pending?', a: 'Pending means the merchant has authorised the amount but has not settled it yet. Most pending payments complete within 72 hours. Hotels and car rentals can take longer.' },
  { id: 'f3', topic: 'Cards', q: 'How do I freeze a card I cannot find?', a: 'Open Manage, pick the card and tap Freeze. Every new payment is declined instantly, and you can unfreeze the card the moment it turns up.' },
  { id: 'f4', topic: 'Cards', q: 'Can I change my monthly spending limit?', a: 'Yes. Go to Manage → Card controls and drag the monthly limit slider. The new limit applies straight away and is reflected on your dashboard.' },
  { id: 'f5', topic: 'Security', q: 'How do I turn on two-factor authentication?', a: 'Open Account → Security and switch on Two-factor authentication. You will be asked to confirm with a code sent to your phone.' },
  { id: 'f6', topic: 'Security', q: 'I see a sign-in I do not recognise. What should I do?', a: 'Revoke the session from Account → Active sessions, change your password in Settings → Security, and contact support so we can review the account.' },
  { id: 'f7', topic: 'Account', q: 'How do I reactivate an inactive wallet?', a: 'Use the ⋮ menu on the wallet in your dashboard, or flip its status switch in Manage → Wallets. Reactivation is instant and free.' },
  { id: 'f8', topic: 'Account', q: 'Can I hold more than six currencies?', a: 'Standard accounts include six wallets. Gold members and above can open up to twenty currency wallets at no extra cost.' },
]

export const HELP_TOPICS = [
  { id: 'Payments', icon: 'transfer', body: 'Transfers, requests and pending payments' },
  { id: 'Cards', icon: 'card', body: 'Freezing, limits and card controls' },
  { id: 'Security', icon: 'shield', body: 'Sign-ins, passwords and 2FA' },
  { id: 'Account', icon: 'user', body: 'Wallets, profile and plans' },
]
