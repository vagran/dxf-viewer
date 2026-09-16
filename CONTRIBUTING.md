Anyone can participate in `dxf-viewer` development, taking into account the following
recommendations:

 1. Propose your changes in the form of pull requests into the `master` branch of this repository.
 2. The pull requests should preferably contain one commit with all the necessary changes. There
    should not be any unrelated changes in a specific PR. You can use a dedicated development branch
    in your forked repository for a changeset. You can use Git rebase with squashing to squash
    several commits into one.
 3. Please follow the existing code's coding style and general approach so that your code does not
    look very different from the surrounding code. Most of the mechanical part of that is
    automated — `npm run format` rewrites your changes to match, and `npm run lint` reports without
    writing. It is a formatter only: no rule in it has an opinion about the code itself.
 4. Run the automated checks before submitting. They need nothing but `npm install` in this
    repository — no browser, no dev server, and no DXF files of your own — and take a few seconds:

    ```bash
    npm install
    npm test            # unit tests, scene goldens, invariants
    npm run typecheck   # the published type declarations, as a consumer sees them
    npm run lint        # formatting only; `npm run format` fixes what it reports
    ```

    Node 22 or newer is required for development; the library itself has no such requirement. The
    same checks run on every pull request. See [test/README.md](test/README.md) for what each part
    covers and how to add to it.
 5. **The automated checks cannot tell you whether a drawing looks right.** They cover geometry,
    packaging and module hygiene; nothing in them renders anything. So please also check your
    change by eye, with several different files, and verify that there are no errors in the
    JavaScript console. You can use
    [this example project](https://github.com/vagran/dxf-viewer-example-src) for that. You can
    replace the `dxf-viewer` dependency in its `package.json` with your local path to `dxf-viewer`
    so that a symbolic link is created in the `node_modules` directory when running `npm install`.

    For a quicker first look, `npm run svg -- your-drawing.dxf out.svg --font <some-font.ttf>`
    renders a drawing to SVG through the same code the viewer uses, without a browser.
 6. If your change fixes a rendering bug or adds support for something, please add a test for it.
    A small synthetic drawing plus its expected output is usually enough, and both are generated —
    see [test/fixtures/README.md](test/fixtures/README.md). A test that fails before your change
    and passes after it is the most useful thing you can put in a PR, and it is what keeps the fix
    from being undone later.
 7. It would be nice if you provide some screenshots demonstrating the effects of your changes.
    Also, providing test `.dxf` files is very welcome.
 8. Feel free to add yourself to the `CONTRIBUTORS` file if you are adding a significant feature or
    bug fix.
