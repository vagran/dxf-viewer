Anyone can participate in `dxf-viewer` development, taking into account the following
recommendations:

 1. Propose your changes in the form of pull requests into the `master` branch of this repository.
 2. The pull requests should preferably contain one commit with all the necessary changes. There
    should not be any unrelated changes in a specific PR. You can use a dedicated development branch
    in your forked repository for a changeset. You can use Git rebase with squashing to squash
    several commits into one.
 3. Please follow the existing code's coding style and general approach so that your code does not
    look very different from the surrounding code.
 4. Please test your changes before submitting them. Check with different files and verify that
    there are no errors in the JavaScript console. You can use
    [this example project](https://github.com/vagran/dxf-viewer-example-src) to test your changes.
    You can replace the `dxf-viewer` dependency in its `package.json` with your local path to
    `dxf-viewer` so that a symbolic link is created in the `node_modules` directory when running
    `npm install`.
 5. It would be nice if you provide some screenshots demonstrating the effects of your changes.
    Also, providing test `.dxf` files is very welcome.
 6. Feel free to add yourself to the `CONTRIBUTORS` file if you are adding a significant feature or
    bug fix.
