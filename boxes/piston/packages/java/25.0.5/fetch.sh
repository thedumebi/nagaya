# Temurin 25.0.5+8, the current LTS.
fetch "https://github.com/adoptium/temurin25-binaries/releases/download/jdk-25.0.5%2B8/OpenJDK25U-jdk_x64_linux_hotspot_25.0.5_8.tar.gz" \
  sha256 68982529869257d0ee6b824ec5aa270ff8b118bb438670da0b97ebdab178d7fb java.tar.gz
tar xzf java.tar.gz --strip-components=1
rm java.tar.gz

# Not needed to compile or run a source file.
rm -rf jmods lib/src.zip man demo
