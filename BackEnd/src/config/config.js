const sql = require("mysql2");
require ("dontev").config();

export const db = mysql.createConnection({
    host: "localhost",
    user: "root",
    password: "1234",
    database: "dbpapercraft",
    port: 3306,
});
