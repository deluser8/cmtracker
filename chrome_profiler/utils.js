/* 日期格式化 */
formatDate = function (date) {
    const y = date.getFullYear();
    let m = date.getMonth() + 1;
    m = m < 10 ? '0' + m : m;
    let d = date.getDate();
    d = d < 10 ? ('0' + d) : d;
    return y + '-' + m + '-' + d;
};

/* 时间格式化 */
formatTime = function (date) {
    let h = date.getHours();
    h = h < 10 ? '0' + h : h;
    let m = date.getMinutes();
    m = m < 10 ? '0' + m : m;
    let s = date.getSeconds();
    s = s < 10 ? '0' + s : s;
    return h + ':' + m + ':' + s;
};

/* 日期时间格式化 */
formatDateTime = function (date) {
    const fDate = formatDate(date);
    const fTime = formatTime(date);
    return fDate + ' ' + fTime;
};

/* 等待 xx 时间 */
delay = function (timeout) {
    return new Promise(function (resolve, reject) {
        setTimeout(function () {
            resolve();
        }, timeout*1000);
    })
};

formatStr = function(s) {
    return s.replace("'", "\'");
}

exports.delay = delay;
exports.formatStr = formatStr;
exports.formatDate = formatDate;
exports.formatTime = formatTime;
exports.formatDateTime = formatDateTime;