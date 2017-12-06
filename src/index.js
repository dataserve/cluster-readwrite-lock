"use strict";

const Hub = require("cluster-hub");
const ReadwriteLock = require("readwrite-lock");

class LockServer {

    constructor(parent, opts) {
        this.parent = parent;
        
        this.lock = new ReadwriteLock(opts);
        
        this.acquiredCnt = {};
        
        this.acquiredResolve = {};

        parent.cluster.on('exit', (worker) => {
            let workerId = worker.id;

            if (!this.acquiredResolve[workerId]) {
                return;
            }

            for (let lockId in this.acquiredResolve[workerId]) {
                this.releaseLock(workerId, lockId, true);
            }
        });
        
        parent.hub.on("acquireLock", (data, worker, callback) => {
            let workerId = worker.id;
            
            let fn = data.isWrite ? "acquireRead" : "acquireWrite";
            
            this.lock[fn](data.key, () => {
                if (!this.acquiredCnt[workerId]) {
                    this.acquiredCnt[workerId] = 1;
                }
                
                let cnt = this.acquiredCnt[workerId]++;
                
                callback(null, cnt);
                
                return new Promise((resolve, reject) => {
                    if (!this.acquiredResolve[workerId]) {
                        this.acquiredResolve[workerId] = {};
                    }
                    
                    this.acquiredResolve[workerId][cnt] = resolve;
                });
            }, data.opts);
        });

        parent.hub.on("releaseLock", (data, worker, callback) => {
            let workerId = worker.id;
            
            let err = this.releaseLock(workerId, data.id, true);
            
            callback(err);
        });
    }

    releaseLock(workerId, lockId, isSuccess) {
        if (!this.acquiredResolve[workerId] || !this.acquiredResolve[workerId][lockId]) {
            return "lock not found";
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

    constructor(parent, opts) {
        this.parent = parent;
    }

    acquire(isWrite, key, fn, opts) {
        return new Promise((resolve, reject) => {
            this.parent.hub.requestMaster("acquireLock", {isWrite, key, opts}, (err, id) => {
                this._promiseTry(fn)
                    .catch((err) => {
                        reject(err);
                    })
                    .then(() => {
                        this.parent.hub.requestMaster("releaseLock", {id}, (err) => {
                            if (err) {
                                reject(err);
                            } else {
                                resolve();
                            }
                        });
                    });
            });
        });
    }

    _promiseTry(fn) {
        try {
            return this.parent.Promise.resolve(fn());
        } catch (e) {
            return this.parent.Promise.reject(e);
        }
    }
    
}

class ClusterReadwriteLock {

    constructor(cluster, opts) {
        opts = opts || {};

        this.cluster = cluster;
        
        this.Promise = opts.Promise || Promise;
        
        this.hub = new Hub;

        if (cluster.isMaster) {
            this.server = new LockServer(this, opts);
        } else {
            this.client = new LockClient(this, opts);
        }
    }

    acquireRead(key, fn, opts) {
        if (this.server) {
            throw new Error("cluster master cannot acquire lock");
        }
        
        return this.client.acquire(false, key, fn, opts);
    }

    acquireWrite(key, fn, opts) {
        if (this.server) {
            throw new Error("cluster master cannot acquire lock");
        }
        
        return this.client.acquire(true, key, fn, opts);
    }

}

module.exports = ClusterReadwriteLock;
