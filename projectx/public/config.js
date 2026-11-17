/*
 * ProjectX site settings.
 *
 * This is the one file to edit when you change events, prices, lineups,
 * contact details or the FAQ. The website reads it in the browser and the
 * payment function reads it on the server, so the server always charges the
 * prices written here, whatever a visitor's browser sends.
 *
 * Dates are Dubai time: "2026-11-28T21:00:00+04:00" means 9 PM on 28 Nov 2026.
 * Run `npm test` after editing to catch typos.
 */
(function (root, settings) {
  if (typeof module === 'object' && module.exports) module.exports = settings;
  else root.PROJECTX = settings;
})(typeof globalThis !== 'undefined' ? globalThis : this, {
  brand: {
    name: 'ProjectX',
    city: 'Dubai'
  },

  contact: {
    // WhatsApp number in international format, digits only: '971501234567'.
    // Leave empty and every WhatsApp button stays hidden.
    whatsapp: '',
    instagram: '', // handle without the @
    tiktok: '',    // handle without the @
    email: ''
  },

  payments: {
    currency: 'AED',
    vatRate: 0.05,              // UAE VAT. Every price below already includes it.
    endpoint: '/api/checkout',  // the Netlify function in netlify/functions/checkout.js
    maxTicketsPerOrder: 20
  },

  audio: {
    // Path to your own DJ mix (MP3) to play instead of the built-in beat,
    // for example 'media/mix.mp3'. Only use music you have the rights to.
    mixUrl: ''
  },

  minAge: 21,

  guestList: {
    enabled: true,
    title: 'Ladies’ list',
    text: 'Ladies on the list get free entry before 01:00. Gents and mixed groups need a ticket. The door has the final say.'
  },

  // vibe sets the hero's colours and beat for that night: 'afro', 'techno' or 'hiphop'.
  // status: 'on-sale', 'selling-fast', 'early-bird' or 'sold-out'.
  // ticketUrl: link to the night on an outside ticketing site. When set, every
  // "Get tickets" button goes there and the built-in checkout is switched off
  // for that night.
  // Lineup names below are PLACEHOLDERS. Replace them with your real artists.
  events: [
    {
      id: 'exp07',
      number: '07',
      title: 'After Dark',
      start: '2026-11-28T21:00:00+04:00',
      end: '2026-11-29T03:00:00+04:00',
      area: 'Rooftop · Dubai Marina',
      locationNote: 'Exact location goes to ticket holders 24 hours before doors.',
      genres: ['Afro House', 'Melodic House'],
      vibe: 'afro',
      status: 'selling-fast',
      ticketUrl: '',
      ticketSiteName: '',
      lineup: [
        { name: 'Secret headliner', secret: true, time: '00:30–02:30', genre: 'Afro House' },
        { name: 'Midnight Caravan', time: '23:00–00:30', genre: 'Afro / Melodic' },
        { name: 'Halo District', time: '21:30–23:00', genre: 'Organic House' },
        { name: 'PX Residents', time: '21:00–21:30', genre: 'Warm-up' }
      ],
      tiers: [
        { id: 'early', name: 'Early Bird', price: 150, perks: ['Entry before 23:00'], soldOut: true },
        { id: 'ga', name: 'General', price: 200, perks: ['Entry all night', 'Dancefloor access'] },
        { id: 'vip', name: 'VIP', price: 450, perks: ['Fast-track entry', 'VIP deck and bar', 'Welcome drink'] },
        { id: 'table', name: 'VIP Table', price: 5000, perks: ['Up to 6 guests', 'Premium bottle package', 'Dedicated host'], maxPerOrder: 1 }
      ]
    },
    {
      id: 'exp08',
      number: '08',
      title: 'Dunes',
      start: '2026-12-12T20:00:00+04:00',
      end: '2026-12-13T03:00:00+04:00',
      area: 'Desert · 45 min from Downtown',
      locationNote: 'Shuttle from Downtown Dubai is included. Pickup details come with your ticket.',
      genres: ['Melodic Techno', 'Techno'],
      vibe: 'techno',
      status: 'on-sale',
      ticketUrl: '',
      ticketSiteName: '',
      lineup: [
        { name: 'Secret headliner', secret: true, time: '01:00–03:00', genre: 'Melodic Techno' },
        { name: 'Mirage Protocol', time: '23:00–01:00', genre: 'Techno' },
        { name: 'Ultraviolet Souk', time: '21:30–23:00', genre: 'Indie Dance' },
        { name: 'PX Residents', time: '20:00–21:30', genre: 'Warm-up' }
      ],
      tiers: [
        { id: 'early', name: 'Early Bird', price: 225, perks: ['Entry and shuttle'], soldOut: true },
        { id: 'ga', name: 'General', price: 295, perks: ['Entry and shuttle', 'Dancefloor access'] },
        { id: 'vip', name: 'VIP', price: 595, perks: ['Fast-track shuttle', 'VIP dune deck', 'Welcome drink'] },
        { id: 'table', name: 'VIP Table', price: 7500, perks: ['Up to 6 guests', 'Premium bottle package', 'Private shuttle'], maxPerOrder: 1 }
      ]
    },
    {
      id: 'exp09',
      number: '09',
      title: 'New Year’s Eve',
      start: '2026-12-31T21:00:00+04:00',
      end: '2027-01-01T03:00:00+04:00',
      area: 'Secret location · Palm Jumeirah',
      locationNote: 'Exact location goes to ticket holders 24 hours before doors.',
      genres: ['Hip-Hop', 'R&B', 'House'],
      vibe: 'hiphop',
      status: 'early-bird',
      ticketUrl: '',
      ticketSiteName: '',
      lineup: [
        { name: 'Secret headliner', secret: true, time: '23:30–01:30', genre: 'Hip-Hop / R&B' },
        { name: 'Gold Room Collective', time: '22:00–23:30', genre: 'R&B' },
        { name: '808 Majlis', time: '01:30–03:00', genre: 'Hip-Hop / House' },
        { name: 'PX Residents', time: '21:00–22:00', genre: 'Warm-up' }
      ],
      tiers: [
        { id: 'early', name: 'Early Bird', price: 395, perks: ['Entry before 22:00', 'Midnight countdown'] },
        { id: 'ga', name: 'General', price: 495, perks: ['Entry all night', 'Midnight countdown'] },
        { id: 'vip', name: 'VIP', price: 995, perks: ['Fast-track entry', 'VIP deck and bar', 'Midnight toast'] },
        { id: 'table', name: 'VIP Table', price: 15000, perks: ['Up to 6 guests', 'Two premium bottles', 'Dedicated host'], maxPerOrder: 1 }
      ]
    }
  ],

  faq: [
    {
      q: 'How old do I need to be?',
      a: '21 or older. Bring your original Emirates ID, passport or GCC ID. Photos of ID are not accepted. No ID means no entry and no refund.'
    },
    {
      q: 'Where is the party?',
      a: 'Each night lists its area. The exact location goes to ticket holders by email and WhatsApp 24 hours before doors.'
    },
    {
      q: 'How do I get my ticket?',
      a: 'After you pay, Stripe emails you a receipt. That receipt is your ticket. Show it at the door with your ID. The name on the order must match the ID.'
    },
    {
      q: 'What is the dress code?',
      a: 'Smart and sharp. No sportswear, flip-flops or caps.'
    },
    {
      q: 'Can I get a refund?',
      a: 'Tickets are non-refundable. You can move a ticket to a friend up to 24 hours before doors by messaging us. If we cancel a night, you get a full refund.'
    },
    {
      q: 'How do tables work?',
      a: 'A table seats up to 6 guests and comes with a bottle package and your own host. For bigger groups or custom packages, message our team.'
    },
    {
      q: 'Is there a door policy?',
      a: 'Yes. Right of admission is reserved. Arrive on time, bring your ID and bring good energy.'
    }
  ]
});
