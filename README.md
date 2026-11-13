# quadrumtechnologies.com

Source of the Quadrum Technologies company site (static HTML, no build step).

- `index.html`, `assets/`: the site
- `404.html`: the page Cloudflare Pages serves, with status 404, for any path that doesn't exist
- `_headers`: Cloudflare Pages response headers
- `release/quadrum-site.zip`: the same files zipped for a Cloudflare Pages direct upload

Hosted on Cloudflare Pages (project `quadrumtechnologies`), with quadrumtechnologies.com and www as custom domains.
This branch can move to its own repository later; nothing in the API (`main`) depends on it.
