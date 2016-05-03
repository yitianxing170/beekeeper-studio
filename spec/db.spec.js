import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { db } from '../src';
import config from './databases/config';
chai.use(chaiAsPromised);

/**
 * List of supported DB clients.
 * The "integration" tests will be executed for all supported DB clients.
 * And ensure all these clients has the same API and output results.
 */
const SUPPORTED_DB_CLIENTS = ['mysql', 'postgresql', 'sqlserver'];


/**
 * List of selected databases to be tested in the current task
 */
const dbsToTest = (process.env.DB_CLIENTS || '').split(',').filter(client => !!client);


describe('db', () => {
  const dbClients = dbsToTest.length ? dbsToTest : SUPPORTED_DB_CLIENTS;
  if (dbClients.some(dbClient => !~SUPPORTED_DB_CLIENTS.indexOf(dbClient))) {
    throw new Error('Invalid selected db client for tests');
  }

  dbClients.map(dbClient => {
    describe(dbClient, () => {
      describe('.connect', () => {
        it(`should connect into a ${dbClient} database`, () => {
          const serverInfo = {
            ...config[dbClient],
            name: dbClient,
            client: dbClient,
          };

          const serverSession = db.createServer(serverInfo);
          const dbConn = serverSession.createConnection(serverInfo.database);

          return expect(dbConn.connect()).to.not.be.rejected;
        });

        it('should connect into server without database specified', () => {
          const serverInfo = {
            ...config[dbClient],
            database: db.CLIENTS.find(c => c.key === dbClient).defaultDatabase,
            name: dbClient,
            client: dbClient,
          };

          const serverSession = db.createServer(serverInfo);
          const dbConn = serverSession.createConnection(serverInfo.database);

          return expect(dbConn.connect()).to.not.be.rejected;
        });
      });

      describe('given is already connected', () => {
        const serverInfo = {
          ...config[dbClient],
          name: dbClient,
          client: dbClient,
        };

        let serverSession;
        let dbConn;
        beforeEach(() => {
          serverSession = db.createServer(serverInfo);
          dbConn = serverSession.createConnection(serverInfo.database);
          return dbConn.connect();
        });

        describe('.listDatabases', () => {
          it('should list all databases', async () => {
            const databases = await dbConn.listDatabases();
            expect(databases).to.include.members(['sqlectron']);
          });
        });

        describe('.listTables', () => {
          it('should list all tables', async () => {
            const tables = await dbConn.listTables();
            expect(tables).to.include.members(['users', 'roles']);
          });
        });

        describe('.listViews', () => {
          it('should list all views', async () => {
            const views = await dbConn.listViews();
            expect(views).to.include.members(['email_view']);
          });
        });

        describe('.listRoutines', () => {
          it('should list all routines with their type and definition', async() =>{
            const routines = await dbConn.listRoutines();
            const routine = dbClient === 'postgresql' ? routines[1] : routines[0];

            // Postgresql routine type is always function. SP do not exist
            // Futhermore, PostgreSQL is expected to have two functions in schema, because
            // additional one is needed for trigger
            if (dbClient === 'postgresql') {
              expect(routines).to.have.length(2);
              expect(routine).to.have.deep.property('routineType').to.eql('FUNCTION');
            } else {
              expect(routines).to.have.length(1);
              expect(routine).to.have.deep.property('routineType').to.eql('PROCEDURE');
            }

            // Check routine definition
            if (dbClient === 'mssql') {
              expect(routine).to.have.deep.property('routineDefinition').to.contain('SELECT @Count = COUNT(*) FROM dbo.users');
            } else {
              expect(routine).to.have.deep.property('routineDefinition').to.contain('SELECT COUNT(*) FROM users');
            }
          });
        });

        describe('.listTableColumns', () => {
          it('should list all columns and their type from users table', async() => {
            const columns = await dbConn.listTableColumns('users');
            expect(columns).to.have.length(4);
            const [firstCol, secondCol, thirdCol, fourthCol ] = columns;

            expect(firstCol).to.have.property('columnName').to.eql('id');
            expect(secondCol).to.have.property('columnName').to.eql('username');
            expect(thirdCol).to.have.property('columnName').to.eql('email');
            expect(fourthCol).to.have.property('columnName').to.eql('password');

            expect(firstCol).to.have.property('dataType').to.have.string('int');

            // According to schemas defined in specs, Postgresql has last three column
            // types set as text, while in mysql and mssql they are defined as varchar
            if (dbClient === 'postgresql') {
              expect(secondCol).to.have.property('dataType').to.eql('text');
              expect(thirdCol).to.have.property('dataType').to.eql('text');
              expect(fourthCol).to.have.property('dataType').to.eql('text');
            } else {
              expect(secondCol).to.have.property('dataType').to.eql('varchar');
              expect(thirdCol).to.have.property('dataType').to.eql('varchar');
              expect(fourthCol).to.have.property('dataType').to.eql('varchar');
            }
          });
        });

        describe('.listTableTriggers', () => {
          it('should list all table related triggers', async() => {
            const triggers = await dbConn.listTableTriggers('users');
            expect(triggers).to.have.length(1);
            expect(triggers).to.include.members(['dummy_trigger']);
          });
        });

        describe('.getTableCreateScript', () => {
          it('should return table create script', async() => {
            const [createScript] = await dbConn.getTableCreateScript('users');

            if (dbClient === 'mysql') {
              expect(createScript).to.eql('CREATE TABLE `users` (\n' +
                '  `id` int(11) NOT NULL AUTO_INCREMENT,\n' +
                '  `username` varchar(45) DEFAULT NULL,\n' +
                '  `email` varchar(150) DEFAULT NULL,\n' +
                '  `password` varchar(45) DEFAULT NULL,\n' +
                '  PRIMARY KEY (`id`)\n' +
              ') ENGINE=InnoDB DEFAULT CHARSET=latin1');
            } else if (dbClient === 'postgresql') {
              expect(createScript).to.eql('CREATE TABLE users (\n' +
                '  id integer NOT NULL,\n' +
                '  username text NOT NULL,\n' +
                '  email text NOT NULL,\n' +
                '  password text NOT NULL\n' +
                ');'
              );
            } else { // dbClient === SQL Server
              expect(createScript).to.eql('CREATE TABLE users (\n' +
                '  id int IDENTITY(1,1) NOT NULL,\n' +
                '  username varchar(45)  NULL,\n' +
                '  email varchar(150)  NULL,\n' +
                '  password varchar(45)  NULL,\n' +
                ')\n' +
                '\n' +
                'ALTER TABLE users ADD CONSTRAINT PK__users__3213E83F6E4B38A9 PRIMARY KEY (id)'
              );
            }
          });
        });

        describe('.executeQuery', () => {
          beforeEach(() => Promise.all([
            dbConn.executeQuery(`
              INSERT INTO users (username, email, password)
              VALUES ('maxcnunes', 'maxcnunes@gmail.com', '123456')
            `),
            dbConn.executeQuery(`
              INSERT INTO roles (name)
              VALUES ('developer')
            `),
          ]));

          afterEach(() => dbConn.truncateAllTables());

          describe('SELECT', () => {
            it('should execute an empty query', async () => {
              const results = await dbConn.executeQuery('');

              expect(results).to.have.length(0);
            });

            it('should execute an query with only comments', async () => {
              const results = await dbConn.executeQuery('-- my comment');

              // MySQL treats commented query as a non select query
              if (dbClient === 'mysql') {
                expect(results).to.have.length(1);
              } else {
                expect(results).to.have.length(0);
              }
            });

            it('should execute a single query with empty result', async () => {
              const results = await dbConn.executeQuery(`select * from users where id < 0`);

              expect(results).to.have.length(1);
              const [result] = results;

              // MSSQL does not return the fields when the result is empty.
              // For those DBs that return the field names even when the result
              // is empty we should ensure all fields are included.
              if (dbClient === 'sqlserver') {
                expect(result).to.have.property('fields').to.eql([]);
              } else {
                expect(result).to.have.deep.property('fields[0].name').to.eql('id');
                expect(result).to.have.deep.property('fields[1].name').to.eql('username');
                expect(result).to.have.deep.property('fields[2].name').to.eql('email');
                expect(result).to.have.deep.property('fields[3].name').to.eql('password');
              }

              expect(result).to.have.property('isSelect').to.eql(true);
              expect(result).to.have.property('rows').to.eql([]);
              expect(result).to.have.deep.property('rowCount').to.eql(0);
            });

            it('should execute a single query', async () => {
              const results = await dbConn.executeQuery(`select * from users`);

              expect(results).to.have.length(1);
              const [result] = results;

              expect(result).to.have.deep.property('fields[0].name').to.eql('id');
              expect(result).to.have.deep.property('fields[1].name').to.eql('username');
              expect(result).to.have.deep.property('fields[2].name').to.eql('email');
              expect(result).to.have.deep.property('fields[3].name').to.eql('password');

              expect(result).to.have.deep.property('rows[0].id').to.eql(1);
              expect(result).to.have.deep.property('rows[0].username').to.eql('maxcnunes');
              expect(result).to.have.deep.property('rows[0].password').to.eql('123456');
              expect(result).to.have.deep.property('rows[0].email').to.eql('maxcnunes@gmail.com');

              expect(result).to.have.property('isSelect').to.eql(true);
              expect(result).to.have.deep.property('rowCount').to.eql(1);
            });

            it('should execute multiple queries', async () => {
              const results = await dbConn.executeQuery(`
                select * from users;
                select * from roles;
              `);

              expect(results).to.have.length(2);
              const [firstResult, secondResult] = results;

              expect(firstResult).to.have.deep.property('fields[0].name').to.eql('id');
              expect(firstResult).to.have.deep.property('fields[1].name').to.eql('username');
              expect(firstResult).to.have.deep.property('fields[2].name').to.eql('email');
              expect(firstResult).to.have.deep.property('fields[3].name').to.eql('password');

              expect(firstResult).to.have.deep.property('rows[0].id').to.eql(1);
              expect(firstResult).to.have.deep.property('rows[0].username').to.eql('maxcnunes');
              expect(firstResult).to.have.deep.property('rows[0].password').to.eql('123456');
              expect(firstResult).to.have.deep.property('rows[0].email').to.eql('maxcnunes@gmail.com');

              expect(firstResult).to.have.property('isSelect').to.eql(true);
              expect(firstResult).to.have.deep.property('rowCount').to.eql(1);

              expect(secondResult).to.have.deep.property('fields[0].name').to.eql('id');
              expect(secondResult).to.have.deep.property('fields[1].name').to.eql('name');

              expect(secondResult).to.have.deep.property('rows[0].id').to.eql(1);
              expect(secondResult).to.have.deep.property('rows[0].name').to.eql('developer');

              expect(secondResult).to.have.property('isSelect').to.eql(true);
              expect(secondResult).to.have.deep.property('rowCount').to.eql(1);
            });
          });

          describe('INSERT', () => {
            it('should execute a single query', async () => {
              const results = await dbConn.executeQuery(`
                insert into users (username, email, password)
                values ('user', 'user@hotmail.com', '123456')
              `);

              expect(results).to.have.length(1);
              const [result] = results;

              expect(result).to.have.property('rows').to.eql([]);
              expect(result).to.have.property('fields').to.eql([]);
              expect(result).to.have.property('affectedRows').to.eql(1);
              expect(result).to.have.property('isSelect').to.eql(false);

              // MSSQL does not return row count
              // so this value is based in the number of rows
              if (dbClient === 'sqlserver') {
                expect(result).to.have.property('rowCount').to.eql(0);
              } else {
                expect(result).to.have.property('rowCount').to.eql(undefined);
              }
            });

            it('should execute multiple queries', async () => {
              const results = await dbConn.executeQuery(`
                insert into users (username, email, password)
                values ('user', 'user@hotmail.com', '123456');

                insert into roles (name)
                values ('manager');
              `);

              // MSSQL treats multiple non select queries as a single query result
              if (dbClient === 'sqlserver') {
                expect(results).to.have.length(1);
                const [result] = results;

                expect(result).to.have.property('rows').to.eql([]);
                expect(result).to.have.property('fields').to.eql([]);
                expect(result).to.have.property('isSelect').to.eql(false);
                expect(result).to.have.property('rowCount').to.eql(0);
                expect(result).to.have.property('affectedRows').to.eql(2);
              } else {
                expect(results).to.have.length(2);
                const [firstResult, secondResult] = results;

                expect(firstResult).to.have.property('rows').to.eql([]);
                expect(firstResult).to.have.property('fields').to.eql([]);
                expect(firstResult).to.have.property('isSelect').to.eql(false);
                expect(firstResult).to.have.property('rowCount').to.eql(undefined);
                expect(firstResult).to.have.property('affectedRows').to.eql(1);

                expect(secondResult).to.have.property('rows').to.eql([]);
                expect(secondResult).to.have.property('fields').to.eql([]);
                expect(secondResult).to.have.property('isSelect').to.eql(false);
                expect(secondResult).to.have.property('rowCount').to.eql(undefined);
                expect(secondResult).to.have.property('affectedRows').to.eql(1);
              }
            });
          });

          describe('DELETE', () => {
            it('should execute a single query', async () => {
              const results = await dbConn.executeQuery(`
                delete from users where username = 'maxcnunes'
              `);

              expect(results).to.have.length(1);
              const [result] = results;

              expect(result).to.have.property('rows').to.eql([]);
              expect(result).to.have.property('fields').to.eql([]);
              expect(result).to.have.property('affectedRows').to.eql(1);
              expect(result).to.have.property('isSelect').to.eql(false);

              // MSSQL does not return row count
              // so these value is based in the number of rows
              if (dbClient === 'sqlserver') {
                expect(result).to.have.property('rowCount').to.eql(0);
              } else {
                expect(result).to.have.property('rowCount').to.eql(undefined);
              }
            });

            it('should execute multiple queries', async () => {
              const results = await dbConn.executeQuery(`
                delete from users where username = 'maxcnunes';
                delete from roles where name = 'developer';
              `);

              // MSSQL treats multiple non select queries as a single query result
              if (dbClient === 'sqlserver') {
                expect(results).to.have.length(1);
                const [result] = results;

                expect(result).to.have.property('rows').to.eql([]);
                expect(result).to.have.property('fields').to.eql([]);
                expect(result).to.have.property('isSelect').to.eql(false);
                expect(result).to.have.property('rowCount').to.eql(0);
                expect(result).to.have.property('affectedRows').to.eql(2);
              } else {
                expect(results).to.have.length(2);
                const [firstResult, secondResult] = results;

                expect(firstResult).to.have.property('rows').to.eql([]);
                expect(firstResult).to.have.property('fields').to.eql([]);
                expect(firstResult).to.have.property('isSelect').to.eql(false);
                expect(firstResult).to.have.property('rowCount').to.eql(undefined);
                expect(firstResult).to.have.property('affectedRows').to.eql(1);

                expect(secondResult).to.have.property('rows').to.eql([]);
                expect(secondResult).to.have.property('fields').to.eql([]);
                expect(secondResult).to.have.property('isSelect').to.eql(false);
                expect(secondResult).to.have.property('rowCount').to.eql(undefined);
                expect(secondResult).to.have.property('affectedRows').to.eql(1);
              }
            });
          });

          describe('UPDATE', () => {
            it('should execute a single query', async () => {
              const results = await dbConn.executeQuery(`
                update users set username = 'max' where username = 'maxcnunes'
              `);

              expect(results).to.have.length(1);
              const [result] = results;

              expect(result).to.have.property('rows').to.eql([]);
              expect(result).to.have.property('fields').to.eql([]);
              expect(result).to.have.property('affectedRows').to.eql(1);
              expect(result).to.have.property('isSelect').to.eql(false);

              // MSSQL does not return row count
              // so these value is based in the number of rows
              if (dbClient === 'sqlserver') {
                expect(result).to.have.property('rowCount').to.eql(0);
              } else {
                expect(result).to.have.property('rowCount').to.eql(undefined);
              }
            });

            it('should execute multiple queries', async () => {
              const results = await dbConn.executeQuery(`
                update users set username = 'max' where username = 'maxcnunes';
                update roles set name = 'dev' where name = 'developer';
              `);

              // MSSQL treats multiple non select queries as a single query result
              if (dbClient === 'sqlserver') {
                expect(results).to.have.length(1);
                const [result] = results;

                expect(result).to.have.property('rows').to.eql([]);
                expect(result).to.have.property('fields').to.eql([]);
                expect(result).to.have.property('isSelect').to.eql(false);
                expect(result).to.have.property('rowCount').to.eql(0);
                expect(result).to.have.property('affectedRows').to.eql(2);
              } else {
                expect(results).to.have.length(2);
                const [firstResult, secondResult] = results;

                expect(firstResult).to.have.property('rows').to.eql([]);
                expect(firstResult).to.have.property('fields').to.eql([]);
                expect(firstResult).to.have.property('isSelect').to.eql(false);
                expect(firstResult).to.have.property('rowCount').to.eql(undefined);
                expect(firstResult).to.have.property('affectedRows').to.eql(1);

                expect(secondResult).to.have.property('rows').to.eql([]);
                expect(secondResult).to.have.property('fields').to.eql([]);
                expect(secondResult).to.have.property('isSelect').to.eql(false);
                expect(secondResult).to.have.property('rowCount').to.eql(undefined);
                expect(secondResult).to.have.property('affectedRows').to.eql(1);
              }
            });
          });
        });
      });
    });
  });
});
