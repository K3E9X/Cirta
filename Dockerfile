# [F-P3 2.5] ciirta serve in a container: ICAP on 1344 for a proxy or a mail
# gateway, the HTTP API on 8080. Inspection only, as the command is by
# default; add --block-on <level> or --allow-clean to the command to change it.
#
#   docker build -t ciirta .
#   docker run --rm --read-only --cap-drop ALL --security-opt no-new-privileges \
#     -p 127.0.0.1:1344:1344 -p 127.0.0.1:8080:8080 ciirta
#
# It listens and never connects anywhere; the JSON log of what it saw goes to
# stdout (`docker logs`).

FROM node:22-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
COPY schema ./schema
COPY README.md CHANGELOG.md ./
RUN npm run build && npm pack --pack-destination /tmp && mv /tmp/ciirta-*.tgz /tmp/ciirta.tgz

# What runs is the npm package as a user installs it, and its runtime
# dependencies only; then npm, yarn and corepack go, which nothing needs once
# it is installed.
FROM node:22-alpine AS install
COPY --from=build /tmp/ciirta.tgz /tmp/ciirta.tgz
RUN npm install --global --omit=dev --no-audit --no-fund /tmp/ciirta.tgz \
  && rm -rf /tmp/ciirta.tgz /root/.npm \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn-* \
       /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg

# One layer: the same Alpine and the same Node, without what was removed.
FROM scratch
COPY --from=install / /
ENV NODE_ENV=production PATH=/usr/local/bin:/usr/bin:/bin
USER node
WORKDIR /home/node
EXPOSE 1344 8080
HEALTHCHECK --interval=30s --timeout=5s CMD wget -q -O /dev/null http://127.0.0.1:8080/health || exit 1
ENTRYPOINT ["ciirta"]
CMD ["serve", "--host", "0.0.0.0"]
