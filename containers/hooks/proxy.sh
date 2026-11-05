# © 1993–2026 Abhishek Choudhary. All rights reserved. AyeAI.
# SPDX-License-Identifier: GPL-3.0-or-later
#
# Optional build hook for a machine whose outbound traffic goes through a proxy with its own CA (the build
# machine used for this iteration). ops/run.sh sources it only when SUBCORE_BUILD_HOOK names it, so the
# author's machine (no proxy) is unaffected. It sets DOCKER_BUILD_EXTRA for docker build.
DOCKER_BUILD_EXTRA=(--network host)
for v in http_proxy https_proxy HTTP_PROXY HTTPS_PROXY; do
  if [ -n "${!v:-}" ]; then DOCKER_BUILD_EXTRA+=(--build-arg "$v"); fi
done
if [ -f /root/.ccr/ca-bundle.crt ]; then DOCKER_BUILD_EXTRA+=(--secret id=ca,src=/root/.ccr/ca-bundle.crt); fi
# Containers that fetch at run time (npm pack, git clone) use the same proxy and CA bundle
DOCKER_RUN_EXTRA=(--network host)
for v in http_proxy https_proxy HTTP_PROXY HTTPS_PROXY; do
  if [ -n "${!v:-}" ]; then DOCKER_RUN_EXTRA+=(-e "$v"); fi
done
if [ -f /root/.ccr/ca-bundle.crt ]; then
  DOCKER_RUN_EXTRA+=(-v /root/.ccr/ca-bundle.crt:/etc/subcore-ca.crt:ro -e NODE_EXTRA_CA_CERTS=/etc/subcore-ca.crt
    -e NPM_CONFIG_CAFILE=/etc/subcore-ca.crt -e PIP_CERT=/etc/subcore-ca.crt -e GIT_SSL_CAINFO=/etc/subcore-ca.crt -e CURL_CA_BUNDLE=/etc/subcore-ca.crt)
fi
