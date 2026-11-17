FROM node:22.18-bookworm
RUN curl -fsSL https://raw.githubusercontent.com/notationlabs/factory/main/install.sh | sh
RUN --mount=type=bind,from=runtime,target=/runtime sh /runtime/setup.sh
