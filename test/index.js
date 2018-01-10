'use strict';

const assert = require('chai').assert
const Bluebird = require('bluebird');
const cluster = require('cluster');
const Q = require('q');

const ClusterReadwriteLock = require('../index');
const lock = new ClusterReadwriteLock(cluster);

if (cluster.isMaster) {
    var worker = cluster.fork();
} else {
    function delayPromise(delay) {
        return new Promise((resolve, reject) => {
            setTimeout(resolve, delay);
        });
    }

    function getKey(i) {
        var key;
        
        if (i === 0) {
            key = 'test-key';
        } else if (i === 1) {
            key = [...Array(10).keys()];
        } else {
            key = [];
            for (let i = 0; i < 1000; ++i) {
                key.push(Math.floor(Math.random() * 1000));
            }
        }
        return key;
    }

    describe('ClusterReadwriteLock Tests', function() {
        it('Single write key test', function(done) {
            let runTest = (i) => {
                return new Promise((resolve, reject) => {
                    var taskCount = 8;
                    
                    var finishedCount = 0;
                    
                    var isRunning = {};
                    
                    var taskNumbers = [...Array(taskCount).keys()];

                    taskNumbers.forEach((number) => {
                        let key = getKey(number % 3);
                        
                        lock.acquireWrite(key, () => {
                            assert(!isRunning[key]);
                            
                            let delay = Math.random() * 10;
                            
                            return delayPromise(delay)
                                .then(() => {
                                    isRunning[key] = false;

                                    return 'result';
                                });
                        }).then((result) => {
                            finishedCount++;

                            assert(result === 'result');
                            
                            if (finishedCount === taskCount) {
                                done();
                            }
                        }).catch((err) => {
                            done(err);
                        });
                    });
                });
            };

            lock.setOpt({})
                .then(() => runTest(1))
                .then(() => runTest(2))
                .then(() => runTest(3))
                .then(() => done())
                .catch(err => done(err));
        });

        it('Read/write locks single/multi keys', function(done) {
            var key;

            let runTest = (i) => {
                return new Promise((resolve, reject) => {
                    let write1Done = false, write2Done = false,
                        read1Done = false, read2Done = false,
                        keys = getKey(i),
                        releaseDelay = 10, queueDelay = 0;

                    lock.acquireWrite(keys, () => {
                        assert(!write1Done);
                        
                        return delayPromise(releaseDelay)
                            .then(() => {
                                write1Done = true;

                                return 'res';
                            });
                    }).catch((err) => {
                        reject(err);
                    }).then((result) => {
                        assert(result === 'res');
                        
                        return delayPromise(queueDelay);
                    }).then(() => {
                        lock.acquireWrite(keys, () => {
                            assert(write1Done);
                            
                            assert(!write2Done);
                            
                            return delayPromise(releaseDelay)
                                .then(() => {
                                    write2Done = true;

                                    return 'write';
                                });
                        }).then((result) => {
                            assert(result === 'write');
                        }).catch((err) => {
                            reject(err);
                        });
                    }).then(() => {
                        return delayPromise(queueDelay);
                    }).then(() => {
                        lock.acquireRead(keys, () => {
                            assert(!read1Done);
                            
                            assert(write1Done && write2Done);

                            return delayPromise(releaseDelay)
                                .then(() => {
                                    read1Done = true;

                                    return 'read';
                                });
                        }).then((result) => {
                            assert(result === 'read');
                        }).catch((err) => {
                            reject(err);
                        });
                    }).then(() => {
                        return delayPromise(queueDelay);
                    }).then(() => {
                        lock.acquireRead(keys, () => {
                            assert(!read2Done);
                            
                            assert(write1Done && write2Done);
                            
                            return delayPromise(releaseDelay)
                                .then(() => {
                                    read2Done = true;

                                    return 'read2';
                                });
                        }).then((result) => {
                            assert(result === 'read2');
                        }).catch((err) => {
                            reject(err);
                        });
                    }).then(() => {
                        return delayPromise(queueDelay);
                    }).then(() => {
                        lock.acquireWrite(keys, () => {
                            assert(write1Done && write2Done);
                            
                            assert(read1Done && read2Done);
                            
                            return delayPromise(releaseDelay);
                        }).then(() => {
                            resolve();
                        }).catch((err) => {
                            reject(err);
                        });
                    });
                });
            };

            lock.setOpt({})
                .then(() => runTest(1))
                .then(() => runTest(2))
                .then(() => runTest(3))
                .then(() => done())
                .catch(err => done(err));
        });

        it('Time out test', function(done) {
            let key = 'timeout-test';
            lock.setOpt({timeout: 30}).then(() => {
                lock.acquireWrite(key, () => {
                    return delayPromise(200);
                }).catch((err) => {
                    done(new Error('unexpected error'));
                });
            }).then(() => {
                return delayPromise(10);
            }).then(() => {
                lock.acquireWrite(key, () => {
                    assert(true);
                }).then(() => {
                    done(new Error('should never have finished here'));
                }).catch((err) => {
                    done();
                });
            });
        });

        it('Error handling', function(done) {
            lock.setOpt({}).then(() => {
                lock.acquireWrite('key', () => {
                    throw new Error('error');
                }).then(() => {
                    done(new Error('catch failed'));
                }).catch((err) => {
                    assert(err.message === 'error');
                    done();
                });
            });
        });

        it('Too many pending', function(done) {
            lock.setOpt({maxPending: 1}).then(() => {
                lock.acquireWrite('key', () => {
                    return delayPromise(20);
                });
                lock.acquireWrite('key', () => {
                    return delayPromise(20);
                });
            }).then(() => {
                return delayPromise(10);
            }).then(() => {
                lock.acquireWrite('key', () => {})
                    .then((result) => {
                        done(new Error('error'));
                    })
                    .catch((err) => {
                        done();
                    });
            });
        });

        it('use bluebird promise', function(done) {
            lock.setOpt({Promise: Bluebird})
                .then(() => {
                    lock.acquireWrite('key', () => 'bluebird')
                        .then((result) => {
                            assert(result === 'bluebird');
                            
                            done();
                        }, done);
                });
        });

        it('use Q promise', function(done) {
            lock.setOpt({Promise: Q.Promise})
                .then(() => {
                    lock.acquireWrite('key', () => 'q')
                        .then((result) => {
                            assert(result === 'q');
                            
                            done();
                        }, done);
                });
        });
        
        it('use ES6 promise', function(done) {
            lock.setOpt({Promise: Promise})
                .then(() => {
                    lock.acquireWrite('key', () => 'es6')
                        .then((result) => {
                            assert(result === 'es6');
                            
                            done();
                        }, done);
                });
        });

        it('uses global Promise by default', function(done) {
            lock.setOpt({}).then(() => {
                lock.acquireWrite('key', () => 'global')
                    .then((result) => {
                        assert(result === 'global');
                        
                        done();
                    }, done);
            });
        });

        it('invalid parameter', function(done) {
            lock.setOpt({}).then(() => {
                lock.acquireWrite('key', null)
                    .then(() => {
                        done(new Error('invalid parameter not caught'));
                    }).catch((err) => {
                        done();
                    });
            });
        });
    });
}
