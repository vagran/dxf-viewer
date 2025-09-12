The project is a fork of https://github.com/vagran/dxf-viewer - Kudos to authors and contributors!

# DXF loader

## Install

```bash
npm install dxf-3d-loader
```

## Sync with upstream

Sync happens through a rebase to keep the git history as simple as possible. Create a new pix4d release by appending a "+pix4d" to the package version and generate a new git tag, following the same pattern. For example:

The latest pulled version of the library is "1.0.42".
Make the change in the package.json file:

```diff
-   "version": "1.0.42",
+   "version": "1.0.42+pix4d",
```

Next, commit the change:

```bash
git commit -am "release: pix4d"
```

Next, tag the commit:

```bash
git tag "v1.0.42+pix4d"
```
And push changes to origin:

```bash
git push origin --tags
```

## Contributing

Contribute directly to the main library https://github.com/vagran/dxf-viewer 

## License

This project is licensed under the terms of the
[Mozilla Public License 2.0](https://choosealicense.com/licenses/mpl-2.0/).