const fs = require('fs');
const util = require('util');
const program = require('commander');
const launcher = require('chrome-launcher');
const CDP = require('chrome-remote-interface');

// replace the Promise for high performance
global.Promise = require("bluebird");

const DB = require('./db');
const { env } = require('./env');
const { config, redisConfig } = require('./config');
const { delay, formatDateTime } = require('./utils');

const writeFile = Promise.promisify(fs.writeFile);
const chmod = Promise.promisify(fs.chmod);

let db;

async function writeJson({id, seq, data}) {
    const path = util.format('%s/json/%d_%d.json', config.dst, id, seq);
    try {
        await writeFile(path, JSON.stringify(data));
        const stat = fs.statSync(path);
        if (stat.uid === process.getuid()) {
            await chmod(path, '666')
        }
    } catch (err) {
        console.error(err);
    }
}

async function writeResponse({id, url, data}){
    //  hex encode url
    const name = Buffer.from(url).toString('hex').substring(0, 254);
    const path = `${config.dst}/file/${id}/${name}`;
    try {
        await writeFile(path, JSON.stringify(data));
        const stat = fs.statSync(path);
        if (stat.uid === process.getuid()) {
            await chmod(path, '666')
        }
    } catch (err) {
        console.error(err);
    }
}

const rcvNetworkRequestWillBeSent = async function({id, url, initiator, sourceUrl, requestId}) {
    return;
}

const rcvNetworkGetResponseBody = async function(data, others) {
    if (!data || data.length === 0) {
        return;
    }
    const {id, url} = others;
    await writeResponse({id, url, data});
}

const rcvNetworkResponseReceived = async function({id, url, response, requestId}) {
    return;
}

const rcvProfileStop = async function ({id, seq, data}) {
    await writeJson({id, seq, data});
}

const callbackMap = new Map([
    ['Network.requestWillBeSent', rcvNetworkRequestWillBeSent],
    ['Network.responseReceived', rcvNetworkResponseReceived]    
]);

program
    .version('1.0.0')
    .option('-D --dst <path>', 'your output dst dir', '/home/lancer/share')
    .option('-P --port <port>', 'your chrome debug port', config.port)
    .option('-T --timeout <time>', 'the time to profile', 8)
    .option('-W --waitTime <time>', 'the delay time to wait for website loading', 20)
    .option('-I --interval <time>', 'the interval of each tab', 2)
    .option('-N --num <number>', 'the number of tab to profile before chrome restart', 1000)
    .option('-E --env <env>', 'the environment', 'production');

/* profiler the special url with new tab */
async function newTab(item, timeout, waitTime) {
    const url = encodeURI(item.url);
    const id = item.id;
    await db.startProfile({id});
    if (!fs.existsSync(`${config.dst}/file/${id}`)) {
        fs.mkdirSync(`${config.dst}/file/${id}`);
    }
    try {
        // new tab
        const target = await CDP.New({
            host: config.host,
            port: config.port,
            url: url
        });
        // profile the page
        if (target.type === 'page') {
            var client = await CDP({
                host: config.host,
                port: config.port,
                target: target
            });

            let num = 0;
            let seq = 1;
            let total = 1;
            let websocket = 0;
            const callbackArray = new Array();
            const paramsArray = new Array();      
            const sessions = new Set();
            const requestUrlMap = new Map();
            const wsFrames = new Array();

            const { Debugger, Network, Target, Page, Profiler, Runtime } = client;

            await Promise.all([
                Debugger.enable(),
                Network.enable({
                    maxTotalBufferSize: 10000000,
                    maxResourceBufferSize: 5000000
                }),
                Page.enable(),
                Profiler.enable(),
                Runtime.enable()
            ]);

            await Page.addScriptToEvaluateOnNewDocument({
                source:"Object.defineProperty(navigator, 'hardwareConcurrency', {enumerable: true, get: function() { return 4;} } );"
            });

            await Runtime.evaluate({expression: "Object.defineProperty(navigator, 'hardwareConcurrency', {enumerable: true, get: function() { return 4;} } );"});

            await Target.setAutoAttach({
                autoAttach: true,
                waitForDebuggerOnStart: false
            });

            Network.requestWillBeSent(async ({requestId, request, initiator, }) => {
                const sourceUrl = request.url;
                requestUrlMap.set(requestId, sourceUrl);
                await rcvNetworkRequestWillBeSent({id, url, initiator, sourceUrl, requestId});
            });

            Network.responseReceived(async ({requestId, response})=>{
                const sourceUrl = response.url;
                let {body, base64Encoded} = await Network.getResponseBody({requestId});
                if(base64Encoded){
                    body = Buffer.from(body, 'base64').toString();
                }
                await rcvNetworkResponseReceived({id, url, response, requestId});
                await rcvNetworkGetResponseBody(body, {id, url:sourceUrl});
            });

            Network.webSocketCreated(({url, initiator, requestId})=>{
                websocket = 1;
            });

            /*
            Network.webSocketFrameSent(({response})=>{
                wsFrames.push(response.payloadData);
            });

            Network.webSocketFrameReceived(({response})=>{
                wsFrames.push(response.payloadData);                
            });
            */

            Target.attachedToTarget((obj) => {
                if (obj.sessionId !== undefined) {
                    let sessionId = obj.sessionId;
                    console.log(`attched: ${sessionId}`);
                    sessions.add(sessionId);
                    Target.sendMessageToTarget({
                        message: JSON.stringify({id: seq++, method:"Debugger.enable"}),
                        sessionId: sessionId
                    });
                    Target.sendMessageToTarget({
                        message: JSON.stringify({id: seq++, method:"Network.enable", params:{"maxTotalBufferSize":10000000,"maxResourceBufferSize":5000000}}),
                        sessionId: sessionId
                    });
                    Target.sendMessageToTarget({
                        message: JSON.stringify({id: seq++, method:"Profiler.enable"}),
                        sessionId: sessionId
                    });
                }
            });

            Target.detachedFromTarget((obj) => {
                if (obj.sessionId !== undefined) {
                    console.log(`detached: ${obj.sessionId}`);
                    sessions.delete(obj.sessionId);
                }
            });

            Target.receivedMessageFromTarget(async (obj)=>{
                const message = JSON.parse(obj.message);
                let callback, others;
                if (message.method === 'Debugger.scriptParsed') {
                } else if (message.method !== undefined) {
                    callback = callbackMap.get(message.method);
                    if(callback === rcvNetworkRequestWillBeSent) {
                        const {initiator, request, requestId} = message.params;
                        const sourceUrl = request.url;
                        requestUrlMap.set(requestId, sourceUrl);
                        await callback({id, url, initiator, sourceUrl});
                    } else if (callback === rcvNetworkResponseReceived) {
                        const {response, requestId} = message.params;
                        callbackArray[seq] = rcvNetworkGetResponseBody;
                        const sourceUrl = response.url;
                        paramsArray[seq] = {url: sourceUrl, id};
                        Target.sendMessageToTarget({
                            message: JSON.stringify({id: seq++, method:"Network.getResponseBody", params:{requestId}}),
                            sessionId: obj.sessionId
                        });                    
                        await callback({id, url, requestId, response});
                    }
                } else if(message.id !== undefined) {
                    callback = callbackArray[message.id];
                    if (callback === rcvProfileStop){
                        await callback({id, seq: total++, data: message.result.profile});
                    } else if(callback === rcvNetworkResponseReceived){
                        others = paramsArray[message.id];                        
                        let {body, base64Encoded} = message.result;
                        if(base64Encoded){
                            body = Buffer.from(body, 'base64').toString();
                        }
                        await callback(body, others);
                        delete paramsArray[message.id];
                    }
                    delete callbackArray[message.id];
                }
            });
            
            await delay(waitTime);

            /* if seesions are too many, return */
            if (sessions.size >= 15) {
                await db.finishProfile({id, threads: sessions.size + 1, websocket});
                await CDP.Close({
                    host: config.host,
                    port: config.port,
                    id: target.id
                });
                return;
            }

            await Promise.all([
                (async()=>{
                    /* profile the main thread */
                    await Profiler.setSamplingInterval({interval: 100});
                    await Profiler.start();
                    await delay(timeout);
                    const {profile} = await Profiler.stop();
                    await writeJson({id, seq: 0, data: profile});
                })(),
                (async()=>{
                    /* profile the other thread */
                    await Promise.map(sessions, async (sessionId)=>{
                        await Target.sendMessageToTarget({
                            message: JSON.stringify({id: seq++, method:"Profiler.setSamplingInterval", params:{interval:100}}),
                            sessionId: sessionId
                        });           
                        await Target.sendMessageToTarget({
                            message: JSON.stringify({id: seq++, method:"Profiler.start"}),
                            sessionId: sessionId
                        });
                        await delay(timeout);
                        callbackArray[seq] = rcvProfileStop;
                        Target.sendMessageToTarget({
                            message: JSON.stringify({id: seq++, method:"Profiler.stop"}),
                            sessionId: sessionId
                        });
                    }, {concurrency: 8});
                 })()
            ]);

            num += sessions.size;

            await db.finishProfile({id, threads: num + 1, websocket});

            // to ensure all callback function finish
            await delay(num);

            await CDP.Close({
                host: config.host,
                port: config.port,
                id: target.id
            });
        }
    } catch (err) {
        console.error(err);
    } finally {
        if (client) {
            await client.close();
        }
    }
}

function init() {
    /* 命令行参数解析 */
    program.parse(process.argv);
    config.dst = program.dst;
    config.port = program.port;
    program.interval = parseInt(program.interval);
    program.num = parseInt(program.num);

    if (program.env != 'production') {
        console.log('test env');
        config.dst = './share';
        delete config['chromePath'];
        program.num = 1;
    }

    config.chromeFlags = ['--headless'];
    if (env === 'old') {
        config.chromeFlags.push('--no-sandbox');
    }

    return Promise.all([
        new Promise((resolve) => {
            if (!fs.existsSync(config.dst)) {
                fs.mkdirSync(config.dst);
            }
            if (!fs.existsSync(config.dst + '/json')) {
                fs.mkdirSync(config.dst + '/json');
            }
            if (!fs.existsSync(config.dst + '/file')) {
                fs.mkdirSync(config.dst + '/file');
            }
            resolve();
        })
    ]);
}

async function main() {
    // uncatchexception
    process.on("uncatchException", function (err) {
        console.error(err);
    });
    try {
        /* initial */
        await init();
        const { interval, num, timeout, waitTime } = program;
        /* init db */
        db = new DB({dlimit: 150});
        /* start Chrome */
        const chrome = await launcher.launch(config);
        /* run */
        console.log('************ begin! ************');
        console.log("App run at %s", formatDateTime(new Date()));
        console.log(`want to fetch ${num} urls`);
        const rows = await db.fecthFromRedis({key: 'to_profile', num});
        console.log(`actually fetch ${rows.length} urls`);
        if (rows.length === 0) {
            return;            
        }
        for (let row of rows) {
            newTab(row, timeout, waitTime);
            await delay(interval);
        }
        /* delay for kill Chrome */
        await delay(60);
        console.log("App stop at %s", formatDateTime(new Date()));
        console.log('************ end! ************');
        await Promise.all([
            chrome.kill(),
            db.close()
        ]);
    } catch (err) {
        console.error(err);
    } finally {
        process.exit();
    }
}

main();