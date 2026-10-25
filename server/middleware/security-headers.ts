export default defineEventHandler((event) => {
  setResponseHeader(
    event,
    'Content-Security-Policy',
    "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'",
  )
  setResponseHeader(event, 'X-Frame-Options', 'DENY')
  setResponseHeader(event, 'X-Content-Type-Options', 'nosniff')
  setResponseHeader(event, 'Referrer-Policy', 'no-referrer')
  setResponseHeader(event, 'Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  if (getRequestURL(event).protocol === 'https:') {
    setResponseHeader(event, 'Strict-Transport-Security', 'max-age=31536000')
  }
})
