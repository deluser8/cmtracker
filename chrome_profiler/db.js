const mysql = require('mysql2/promise');
const redis = require('redis')

const { dbConfig, redisConfig } = require('./config');
const { formatDateTime } = require('./utils');

class DB {
    /* 数据库构造函数 */
    constructor({dlimit, rlimit, config}) {

        const mysql_config = config || dbConfig;
        const mysql_limit = dlimit || 100;
        
        this.pool = mysql.createPool(
            Object.assign({
                connectionLimit: mysql_limit
            }, mysql_config)
        );
        
        this.redisLimit = rlimit || 1000;
        this.redisClient = redis.createClient(6379, redisConfig.host);
    }

    /* 关闭数据库连接线程池和 redis 连接 */
    async close() {
        this.redisClient.quit();
        await this.pool.end();
    }

    /* select */
    async select(sql) {
        try {          
            const [row] = await this.pool.query(sql);    
            return row;
        } catch (err) {
            console.error(err);
            return [];
        }
    }

    async startProfile({id}) {
        const timestamp = formatDateTime(new Date());
        const sql = `UPDATE \`profilerUrl\` SET status=3, finishTimeStamp="${timestamp}" WHERE id = ${id}`;
        try {
            await this.pool.execute(sql);
        } catch (err) {
            console.error(err);
        }
    }

    /* 完成 profile 后将数据写回数据库 */
    async finishProfile({id, threads, websocket}) {
        const timestamp = formatDateTime(new Date());
        const sql = `UPDATE \`profilerUrl\` SET status=4, threads=${threads}, webSocket=${websocket} ,finishTimeStamp="${timestamp}" WHERE id = ${id}`;
        try {
            console.log(sql);
            await this.pool.execute(sql);
        } catch (err) {
            console.error(err);
        }
    }

    /* fetch from redis */
    async fecthFromRedis({key, num}) {
        console.log(`need to find from ${key}: ${num} urls`);      

        const ret = [];
        const redisFetches = [];
        
        while(num > 0) {
            const n = Math.min(num, this.redisLimit);
            for (let i = 0; i < n; i++) {
                redisFetches.push(new Promise(resolve => {
                    this.redisClient.blpop(key, 1, function (error, data) {
                        if (error) {
                            console.log('redis fetchNewUrls error : ', error);
                        }
                        resolve(data);
                    });
                }));
            }
    
            await Promise.all(redisFetches).then(function (rows) {
                for (let row of rows) {
                    if(row !== undefined && row !== null) {
                        ret.push(JSON.parse(row[1]));
                    }
                }
            });

            num -= this.redisLimit;
        }

        console.log(`actually find from ${key}: ${ret.length} urls`);
        return ret;
    }

    async fetchNewUrlsMaster(totalUrls) {
        let times = totalUrls / 10;
        console.log('redis db need to find  ' + totalUrls + ' urls');
        console.log('redis db need to find  ' + times + ' times');
        let res = [];
        while (times--) {
            let curRes = await this.fetchNewUrls(10);
            for (let item of curRes)
                res.push(item);
            if (curRes.length < 10)
                break;
        }
        console.log('redis db find ' + res.length + ' urls');
        return res;
    }

    async finishReRunHistory({id, url, cat, init, sourceUrl}) {
        let sql;
        if (init !== undefined) {
            sql = `INSERT INTO \`rerunHistory\` (profilerUrlId, url, cat, init, sourceUrl) VALUES (${id}, '${url}', '${cat}', ${this.pool.escape(init)}, ${this.pool.escape(sourceUrl)})`;
        } else {
            sql = `INSERT INTO \`rerunHistory\` (profilerUrlId, url, cat, sourceUrl) VALUES (${id}, '${url}', '${cat}', '${this.pool.escape(sourceUrl)}')`;            
        }
        try {
            await this.pool.execute(sql);
        } catch (err) {
            console.error(err);
        }
        return;
    }

    async updateTimeSpaceUrls({id, threads}) {
        const timestamp = formatDateTime(new Date());        
        const sql = `UPDATE \`timeSpaceVisit\` SET threads='${threads}', timeStamp='${timestamp}' WHERE id = ${id}`;
        try {
            await this.pool.execute(sql);
        } catch (err) {
            console.error(err);
        }
    }

    async updateRerunUrl({id, threads}) {
        const sql = `UPDATE \`rerunUrl\` SET threads='${threads}' WHERE id = ${id}`;
        try {
            await this.pool.execute(sql);
        } catch (err) {
            console.error(err);
        }
    }

    async finishTimeSpaceHistory({id, url, cat, init, sourceUrl, frames, requestId}) {
        await this.finishNetworkHistory({id, url, cat, init, sourceUrl, frames, requestId, table: 'timeSpaceHistory'});
    }

    async finishNewRequestHistory({id, url, cat, init, sourceUrl, frames, requestId}) {
        await this.finishNetworkHistory({id, url, cat, init, sourceUrl, frames, requestId, table: 'newRequestHistory'});
    }

    async finishNetworkHistory({id, url, cat, init, sourceUrl, frames, requestId, table}) {
        const time = formatDateTime(new Date());
        const obj = {
            profilerUrlId: id,
            time: time,
            url: url,
            requestId, requestId,
            cat: cat,
            init: init,
            sourceUrl: sourceUrl,
            frames: frames
        };
        const keys = [];
        const values = [];
        for(let key in obj){
            if(obj[key] !== undefined) {
                keys.push(key);
                if(key === 'frames') {
                    values.push(`'${obj[key].toString()}'`);                        
                } else {
                    values.push(`${this.pool.escape(obj[key].toString())}`);    
                }
            }
        }
        const sql = `INSERT INTO \`${table}\` (${keys.join(', ')}) VALUES (${values.join(', ')})`;
        try {
            await this.pool.execute(sql);
        } catch (err) {
            console.error(err);
        }
    }
}

module.exports = DB;
