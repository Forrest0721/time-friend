import Fastify from "fastify";

const app = Fastify({ logger: true });

app.get("/health", async () => ({ ok: true }));

const start = async () => {
  try {
    await app.listen({ port: Number(process.env.PORT || 3030) });
    app.log.info("api listening");
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
};

start();

