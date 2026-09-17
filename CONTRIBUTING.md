Anyone can participate in `dxf-viewer` development. Please read the first section below before
opening a pull request — it will most likely save you a lot of work.

## An issue is usually worth more than a pull request

The entrance level for coding in this project is high. What counts as correct rendering is decided
by the many undocumented corners of the DXF format, and a change that looks obviously right on its
own routinely breaks a different drawing elsewhere. Most of those drawings are user-reported and
proprietary, so they live only on the maintainer's machine and there is no way for you to test
against them.

Because of that, **a pull request that fixes a rendering bug is in practice read as a very good bug
report, not as something to merge as it stands.** The drawing you attach is reproduced here, the
cause is established against the format reference, and the fix is usually written afresh so that it
lands in the right module, matches the surrounding code and comes with a test the project can keep.
Your patch is read carefully, and a good idea in it is taken and credited. Please just do not count
on the diff itself going in.

Before reporting a rendering bug, it is worth opening your drawing in the
[release preview](https://vagran.github.io/dxf-viewer-example-preview/) — it runs the current
development code rather than the latest npm release, so the problem may already be fixed there.

If it is not, the most valuable thing you can send is an **issue** containing:

 * **A sample `.dxf` file** that shows the problem. This is by far the most useful part — the
   project is only ever as good as the files it has been tested against. A minimal file made in CAD
   software is ideal, a real one is fine too, and a file produced by a CAD application the
   maintainer has no access to is especially valuable.
 * **A clear scenario**: what you did, what you expected, what you got. Screenshots of both help,
   and a reference rendering from [the Autodesk online viewer](https://viewer.autodesk.com) settles
   most questions about which one is right.
 * **Any analysis you have already done** — which entity, which group code, which part of the
   pipeline. A guess at the cause is very welcome and is never held against you if it turns out to
   be wrong.

None of that requires you to build or run the project, and it is genuinely the more useful thing to
receive.

## If you do want to send a pull request

It is welcome — please just take the following into account:

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
    npm run lint        # formatting only; `npm run format` fixes all of it but over-long lines
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
 6. **Say what you actually checked, and say if the change was written with AI.** Neither is held
    against you — [A note on AI](README.md#a-note-on-ai) in the README explains why it is asked.
    A line like *"opened these three drawings, the fill is right now, console clean"* says more
    than any amount of explanation, and a description claiming tests that did not actually run
    costs everyone a great deal of time.
 7. If your change fixes a rendering bug or adds support for something, please add a test for it.
    A small synthetic drawing plus its expected output is usually enough, and both are generated —
    see [test/fixtures/README.md](test/fixtures/README.md). A test that fails before your change
    and passes after it is the most useful thing you can put in a PR, and it is what keeps the fix
    from being undone later.
 8. It would be nice if you provide some screenshots demonstrating the effects of your changes.
    Also, providing test `.dxf` files is very welcome.
 9. Feel free to add yourself to the `CONTRIBUTORS` file if you are adding a significant feature or
    bug fix.
