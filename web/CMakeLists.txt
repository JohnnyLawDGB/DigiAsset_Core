cmake_minimum_required(VERSION 3.21)

# The legacy C++ RPC-documentation web server (web/main.cpp) was removed in favour
# of the static built-in UI (index.html + css/ + js/ + img/), which is served
# directly by an external web server / reverse proxy (e.g. nginx). There is nothing
# to compile here; optionally install the static assets so `make install` can deploy
# them. NONE disables the (unneeded) compiler/toolchain check for this subdirectory.
project(digiasset_core_web NONE)

install(FILES index.html DESTINATION bin/web)
install(DIRECTORY css js img DESTINATION bin/web)
