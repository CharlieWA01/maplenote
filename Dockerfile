# Maplenote as a Docker image. The same image runs:
#   - on AWS Lambda (files in S3, behind a password; see docs/runbooks/deploy-sandbox.md)
#   - on your own computer or a homelab server:
#       docker build -t maplenote .
#       docker run --rm -p 8000:8080 -v ~/maplenote-files:/data maplenote
#     then open http://localhost:8000
#
# How Lambda fits in: Lambda doesn't speak HTTP to the app; it hands it
# "events". AWS's Lambda Web Adapter, copied in below, turns each event back
# into an ordinary HTTP request to gunicorn on port 8080, and the reply back
# into an event. Outside Lambda the adapter never starts, and gunicorn just
# serves the browser directly.

# The adapter is a single program from AWS's public image registry. Pinned to
# a release, so a rebuild can't pick up a different one silently.
FROM public.ecr.aws/awsguru/aws-lambda-adapter:1.1.0 AS lambda-adapter

# Python 3.11, the same version as the Chromebook and the tests.
FROM python:3.11-slim

# Lambda starts any program found in /opt/extensions alongside the app.
COPY --from=lambda-adapter /lambda-adapter /opt/extensions/lambda-adapter

# Print logs straight away (Lambda sends them to CloudWatch), and don't try
# to write .pyc files: Lambda's disk is read-only except for /tmp.
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PORT=8080 \
    MAPLENOTE_WORKSPACE=/data

WORKDIR /app

# Packages first, then the code: Docker reuses the slow install step for as
# long as the requirements don't change.
COPY requirements.txt requirements-image.txt ./
RUN pip install --no-cache-dir -r requirements-image.txt

COPY app.py auth.py config.py storage.py ./
COPY static ./static

# A build record the About box shows (see static/app.js): the commit this
# image was built from and when. The deploy workflow passes both; a plain
# `docker build` leaves them empty, and the About box says it can't tell.
# Kept after the code, so a new commit only redoes this small step.
ARG MAPLENOTE_COMMIT=""
ARG MAPLENOTE_BUILT=""
RUN printf '{"commit": "%s", "built": "%s"}\n' "$MAPLENOTE_COMMIT" "$MAPLENOTE_BUILT" > static/build.json

# Run as an ordinary user, not root. User 1000 is also the usual owner of
# your own files on Linux (the Chromebook included), so a mounted folder is
# writable without extra steps.
RUN useradd --uid 1000 --no-create-home maplenote && mkdir /data && chown maplenote /data
USER maplenote

EXPOSE 8080

# One worker process, a few threads. One process matters: the local-folder
# storage guards against two saves at once with a lock that only works
# inside a single process. (On Lambda each copy of the function handles one
# request at a time anyway.) The access log goes to the output, which on
# Lambda means CloudWatch Logs. gunicorn's control socket (for managing it
# while it runs) is switched off: it's not needed, and it would try to write
# a file where Lambda's disk is read-only.
CMD ["gunicorn", "--bind", "0.0.0.0:8080", "--workers", "1", "--threads", "4", "--access-logfile", "-", "--no-control-socket", "app:app"]
