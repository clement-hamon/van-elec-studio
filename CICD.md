# CI/CD for GitHub Pages (Free)

This project is designed to deploy automatically to GitHub Pages on every push or merge to the `main` branch. It uses GitHub Actions with the official Pages workflow (build → upload artifact → deploy).

## Repository Setup (One-Time)

1. Create a GitHub repository.
2. In the repository settings, go to **Pages**.
3. Set **Source** to **GitHub Actions**.

## Workflow Overview

The deployment workflow does the following:

1. Checks out the repository.
2. Installs dependencies.
3. Builds the app.
4. Uploads the build output as a Pages artifact.
5. Deploys the artifact to GitHub Pages.

## GitHub Actions Workflow

Create `.github/workflows/pages.yml` with the following content:

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [main]

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - name: Install dependencies
        run: npm install

      - name: Build
        run: npm run build

      - name: Configure Pages
        uses: actions/configure-pages@v5

      - name: Upload artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: dist

  deploy:
    runs-on: ubuntu-latest
    needs: build
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
```

## Vite Base Path (Required for Project Pages)

If the site will be hosted at:

```
https://clement-hamon.github.io/van-elec-studio/
```

then Vite must be configured with the repository name as the base path:

```ts
export default defineConfig({
  base: '/van-elec-studio/',
})
```

If the site is hosted at:

```
https://<user>.github.io/
```

keep `base: '/'`.
