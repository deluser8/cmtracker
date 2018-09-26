/* chrome config */
exports.config = {
    host: '127.0.0.1',
    port: 10086,
    chromePath: ' /usr/bin/google-chrome'// your chrome's path
};

/* database config */
exports.dbConfig = {
    host: '127.0.0.1',
    port: 3306,
    user: 'root',
    password: 'password',
    database: 'tracer'
};

/* redis config */
exports.redisConfig = {
    host: '127.0.0.1',
    port: 6379
};
