# cluster-readwrite-lock

[Read/Write locks](https://en.wikipedia.org/wiki/Readers%E2%80%93writer_lock) on asynchronous code, across a worker cluster.

cluster-readwrite-lock gives you a readwrite lock that you can use across all your workers in a forked NodeJS process. This gives your multiprocess application the ability to handle the same data without causing race conditions between its workers.

## Installation

```
npm install cluster-readwrite-lock
```

## Features

* Uses ES6 promises
* Individual or an array of lock keys supported
* Timeout supported
* Pending task limit supported

## Usage Example

```js
const cluster = require("cluster");
const ClusterReadwriteLock = require("cluster-readwrite-lock");
const lock = new ClusterReadwriteLock(cluster);

function concatHtml() {
    return new Promise((resolve, reject) => {
        htmlDownload("https://www.google.com", googleHtml => {
            fs.writeFile('concat_html.txt', googleHtml, () => {
                htmlDownload("https://www.github.com", githubHtml => {
                    fs.appendFile('concat_html.txt', githubHtml, () => resolve());
                });
            });
        });
    });
}

function readHtml() {
    return new Promise((resolve, reject) => {
        fs.readFile('concat_html.txt', result => resolve(result))
    });
}

if (cluster.isMaster) {
    for (let i = 0; i < 4; ++i) {
        cluster.fork();
    }
} else {
    lock.acquireWrite('key', () => {
        // Concurrency safe
        return concatHtml();
    }).then((result) => {
    }).catch((err) => {
    });
    
    lock.acquireRead('key', () => {
        // Concurrency safe from writes, parallel with other reads
        return readHtml();
    }).then((result) => {
    }).catch((err) => {
    });

    lock.acquireRead('key', () => {
        // Concurrency safe from writes, parallel with other reads
        return readHtml();
    }).then((result) => {
    }).catch((err) => {
    });
}
```

## Getting Started

```js
/**
 * @param {String|Array} key 	resource key or keys to lock
 * @param {function} fn 	execute function
 * @param {Object} opts 	(optional) options
 */
lock.acquireRead(key, () => {
    // critical section
    // return value or promise
}, opts).then(() => {
    // continue execution outside critical section
    // NOTE: LOCK IS RELEASED AS SOON AS CRITICAL SECTION RETURNS
    //       there is no guaranteed order of this "then()" call
    //       compared to other recently released locks of same key
});

/**
 * @param {String|Array} key 	resource key or keys to lock
 * @param {function} fn 	execute function
 * @param {Object} opts 	(optional) options
 */
lock.acquireWrite(key, () => {
    // critical section
    // return value or promise
}, opts).then(() => {
    // continue execution outside critical section
    // NOTE: LOCK IS RELEASED AS SOON AS CRITICAL SECTION RETURNS
    //       there is no guaranteed order of this "then()" call
    //       compared to other recently released locks of same key
});
```

## Options

```js
// Specify timeout
var lock = new ClusterReadwriteLock(cluster, {timeout : 5000});
lock.acquireRead(key, fn)
    .then(() => {
           // critical section will never be entered if timeout occurs
    })
    .catch(err => {
           // timed out error will be returned here if lock not acquired in given time
    });
lock.acquireWrite(key, fn)
    .then(() => {
           // critical section will never be entered if timeout occurs
    })
    .catch(err => {
           // timed out error will be returned here if lock not acquired in given time
    });

// Set max pending tasks
var lock = new ClusterReadwriteLock(cluster, {maxPending : 1000});
lock.acquireRead(key, fn)
    .then(() => {
           // critical section will never be entered if pending limit reached
    })
    .catch(err => {
           // too many pending tasks error will be returned here if lock not acquired in given time
    });
lock.acquireWrite(key, fn)
    .then(() => {
           // critical section will never be entered if pending limit reached
    })
    .catch(err => {
           // too many pending tasks error will be returned here if lock not acquired in given time
    });

// Use your own promise library instead of the global Promise variable
var lock = new ClusterReadwriteLock(cluster, {Promise : require('bluebird')}); // Bluebird
var lock = new ClusterReadwriteLock(cluster, {Promise : require('q').Promise}); // Q
```

## Issues

See [isse tracker](https://github.com/dataserve/cluster-readwrite-lock/issues).

## License

MIT, see [LICENSE](./LICENSE)
