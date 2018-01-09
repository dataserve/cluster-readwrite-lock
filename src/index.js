'use strict';

const Hub = require('cluster-hub');
const ReadwriteLock = require('readwrite-lock');

class LockServer {

    constructor(parent, opt) {
        this.parent = parent;
        
        this.lock = new ReadwriteLock(opt);
        
        this.acquiredCnt = {};
        
        this.acquiredResolve = {};

        this.setOpt(opt);

        this.registerEvents(parent);
    }

    setOpt(opt) {
        opt = opt || {};
        
        this.parent.Promise = opt.Promise || Promise;
        
        this.lock.setOpts(opt);

        return this.parent.Promise.resolve();
    }

    registerEvents(parent) {
        parent.cluster.on('exit', (worker) => {
            let workerId = worker.id;

            if (!this.acquiredResolve[workerId]) {
                return;
            }

            for (let lockId in this.acquiredResolve[workerId]) {
                this.releaseLock(workerId, lockId, false);
            }
        });
        
        parent.hub.on('acquireLock', (data, worker, callback) => {
            if (typeof data.isWrite === 'undefined'
                || typeof data.key === 'undefined') {
                callback('missing params');
            }
            
            let workerId = worker.id;
            
            let fn = data.isWrite ? 'acquireWrite' : 'acquireRead';

            if (!this.acquiredCnt[workerId]) {
                this.acquiredCnt[workerId] = 1;
            }
            
            let lockId = this.acquiredCnt[workerId]++;
            
            this.lock[fn](data.key, () => {
                callback(null, lockId);
                
                return new this.parent.Promise((resolve, reject) => {
                    if (!this.acquiredResolve[workerId]) {
                        this.acquiredResolve[workerId] = {};
                    }
                    
                    this.acquiredResolve[workerId][lockId] = resolve;
                });
            }, data.opt).catch((err) => {
                callback(err);
            });
        });

        parent.hub.on('releaseLock', (data, worker, callback) => {
            let workerId = worker.id;
            
            let err = this.releaseLock(workerId, data.id, true);

            callback(err);
        });

        parent.hub.on('setOpt', (data, worker, callback) => {
            this.setOpt(data.opt);
            
            callback();
        });
    }

    releaseLock(workerId, lockId, isSuccess) {
        if (!this.acquiredResolve[workerId] || !this.acquiredResolve[workerId][lockId]) {
            return 'lock not found';
        }

        if (isSuccess) {
            this.acquiredResolve[workerId][lockId]();
        }
        
        delete this.acquiredResolve[workerId][lockId];
        
        if (!Object.keys(this.acquiredResolve[workerId]).length) {
            delete this.acquiredResolve[workerId];
        }
    }
    
}

class LockClient {

    constructor(parent, opt) {
        this.parent = parent;

        this.setOpt(opt);
    }

    setOpt(opt) {
        opt = opt || {};

        this.parent.Promise = opt.Promise || Promise;

        return new this.parent.Promise((resolve, reject) => {
            this.parent.hub.requestMaster('setOpt', { opt }, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    }

    acquire(isWrite, key, fn, opt) {
        return new this.parent.Promise((resolve, reject) => {
            var lockErr = null;
            
            this.parent.hub.requestMaster('acquireLock', { isWrite, key, opt }, (err, id) => {
                if (err) {
                    reject(err);
                    
                    return;
                }
                
                this._promiseTry(fn)
                    .catch((err) => {
                        lockErr = err;
                    })
                    .then(() => {
                        this.parent.hub.requestMaster('releaseLock', { id }, (err) => {
                            if (err && !lockErr) {
                                lockErr = err;
                            }
                            
                            if (lockErr) {
                                reject(lockErr);
                            } else {
                                resolve();
                            }
                        });
                    });
            });
        });
    }

    _promiseTry(fn) {
        if (typeof fn !== 'function') {
            return this.parent.Promise.reject('invalid function passed');
        }
        
        try {
            return this.parent.Promise.resolve(fn());
        } catch (e) {
            return this.parent.Promise.reject(e);
        }
    }
    
}

class ClusterReadwriteLock {

    constructor(cluster, opt) {
        this.cluster = cluster;
      
        this.hub = new Hub;

        if (cluster.isMaster) {
            this.server = new LockServer(this, opt);
        } else {
            this.client = new LockClient(this, opt);
        }
    }

    setOpt(opt) {
        if (this.server) {
            return this.server.setOpt(opt);
        }
        
        return this.client.setOpt(opt);
    }
    
    acquireRead(key, fn, opt) {
        if (this.server) {
            throw new Error('cluster master cannot acquire lock');
        }
        
        return this.client.acquire(false, key, fn, opt);
    }

    acquireWrite(key, fn, opt) {
        if (this.server) {
            throw new Error('cluster master cannot acquire lock');
        }
        
        return this.client.acquire(true, key, fn, opt);
    }

}

module.exports = ClusterReadwriteLock;
