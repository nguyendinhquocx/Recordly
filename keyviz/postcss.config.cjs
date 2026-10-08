// Keyviz uses Tailwind v4 through the @tailwindcss/vite plugin, so it needs no
// PostCSS plugins of its own. This empty local config stops Vite from searching
// upward and picking up the host repository's postcss.config.cjs (which depends
// on packages that are not part of the keyviz frontend).
module.exports = {};
