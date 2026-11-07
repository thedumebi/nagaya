# python-build-standalone: a prebuilt, relocatable CPython, so no compile step.
fetch "https://github.com/astral-sh/python-build-standalone/releases/download/20261026/cpython-3.14.10%2B20261026-x86_64-unknown-linux-gnu-install_only.tar.gz" \
  sha256 1b38024924eb7f4cf0cab45d7b871d1f1991354190fccd2625ac7529a43786e2 python.tar.gz
tar xzf python.tar.gz --strip-components=1
rm python.tar.gz
