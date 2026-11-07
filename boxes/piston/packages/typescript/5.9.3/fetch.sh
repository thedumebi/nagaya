# This package carries its own Node, like upstream's. Keep it on the same
# release as ../../node.
fetch https://nodejs.org/dist/v24.22.2/node-v24.22.2-linux-x64.tar.xz \
  sha256 48cc0e21e048790e54c0cf5749c2725005313d652651c40b7a21feb9697aaf75 node.tar.xz
tar xf node.tar.xz --strip-components=1
rm node.tar.xz

fetch https://registry.npmjs.org/typescript/-/typescript-5.9.3.tgz \
  sha512 8e5d6f6733c38a72ebf5e52ddc9feded5e8580d130f508ef04f772b33f4a7d00c3e357d0ac2d98e2f290762694a454f86d795bd511e12e9a7cc2d9ba3394e04b \
  typescript.tgz
