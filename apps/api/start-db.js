const EmbeddedPostgres = require('embedded-postgres').default;

async function start() {
    console.log("Starting embedded Postgres...");
    const pg = new EmbeddedPostgres({
        port: 5433,
        databaseDir: './.db',
        user: 'erp',
        password: 'erp_password',
        database: 'school_erp',
    });

    try {
        await pg.initialise();
        await pg.start();
        console.log("✅ Embedded Postgres running on port 5433!");
        
        // Keep process alive
        process.stdin.resume();
        
        process.on('SIGINT', async () => {
            console.log("Stopping Postgres...");
            await pg.stop();
            process.exit(0);
        });
    } catch (err) {
        console.error("Failed to start embedded Postgres:", err);
    }
}

start();
