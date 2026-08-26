package store

import (
	"context"
	"database/sql"
	"fmt"
	"strings"

	_ "github.com/jackc/pgx/v5/stdlib"
	_ "modernc.org/sqlite"
)

type databaseDialect string

const (
	dialectSQLite   databaseDialect = "sqlite"
	dialectPostgres databaseDialect = "postgres"
)

// database keeps the storage queries portable. The application queries use
// question-mark placeholders; PostgreSQL receives the equivalent $1, $2, ...
// form through this adapter.
type database struct {
	raw     *sql.DB
	dialect databaseDialect
}

func (db *database) query(query string) string {
	if db.dialect == dialectPostgres {
		return rebindPostgres(query)
	}
	return query
}

func (db *database) Exec(query string, args ...any) (sql.Result, error) {
	return db.raw.Exec(db.query(query), args...)
}

func (db *database) ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error) {
	return db.raw.ExecContext(ctx, db.query(query), args...)
}

func (db *database) Query(query string, args ...any) (*sql.Rows, error) {
	return db.raw.Query(db.query(query), args...)
}

func (db *database) QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error) {
	return db.raw.QueryContext(ctx, db.query(query), args...)
}

func (db *database) QueryRow(query string, args ...any) *sql.Row {
	return db.raw.QueryRow(db.query(query), args...)
}

func (db *database) QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row {
	return db.raw.QueryRowContext(ctx, db.query(query), args...)
}

func (db *database) Begin() (*transaction, error) {
	tx, err := db.raw.Begin()
	if err != nil {
		return nil, err
	}
	return &transaction{raw: tx, dialect: db.dialect}, nil
}

func (db *database) BeginTx(ctx context.Context, opts *sql.TxOptions) (*transaction, error) {
	tx, err := db.raw.BeginTx(ctx, opts)
	if err != nil {
		return nil, err
	}
	return &transaction{raw: tx, dialect: db.dialect}, nil
}

func (db *database) Close() error                          { return db.raw.Close() }
func (db *database) Ping() error                           { return db.raw.Ping() }
func (db *database) PingContext(ctx context.Context) error { return db.raw.PingContext(ctx) }

type transaction struct {
	raw     *sql.Tx
	dialect databaseDialect
}

func (tx *transaction) query(query string) string {
	if tx.dialect == dialectPostgres {
		return rebindPostgres(query)
	}
	return query
}

func (tx *transaction) Exec(query string, args ...any) (sql.Result, error) {
	return tx.raw.Exec(tx.query(query), args...)
}

func (tx *transaction) ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error) {
	return tx.raw.ExecContext(ctx, tx.query(query), args...)
}

func (tx *transaction) Query(query string, args ...any) (*sql.Rows, error) {
	return tx.raw.Query(tx.query(query), args...)
}

func (tx *transaction) QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error) {
	return tx.raw.QueryContext(ctx, tx.query(query), args...)
}

func (tx *transaction) QueryRow(query string, args ...any) *sql.Row {
	return tx.raw.QueryRow(tx.query(query), args...)
}

func (tx *transaction) QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row {
	return tx.raw.QueryRowContext(ctx, tx.query(query), args...)
}

func (tx *transaction) Commit() error   { return tx.raw.Commit() }
func (tx *transaction) Rollback() error { return tx.raw.Rollback() }

func rebindPostgres(query string) string {
	var out strings.Builder
	out.Grow(len(query) + 16)
	argument := 1
	inString := false
	for i := 0; i < len(query); i++ {
		char := query[i]
		if char == '\'' {
			out.WriteByte(char)
			if inString && i+1 < len(query) && query[i+1] == '\'' {
				i++
				out.WriteByte(query[i])
				continue
			}
			inString = !inString
			continue
		}
		if char == '?' && !inString {
			fmt.Fprintf(&out, "$%d", argument)
			argument++
			continue
		}
		out.WriteByte(char)
	}
	return out.String()
}

func executeSchema(ctx context.Context, db *database, schema string) error {
	for _, statement := range strings.Split(schema, ";") {
		statement = strings.TrimSpace(statement)
		if statement == "" {
			continue
		}
		if _, err := db.ExecContext(ctx, statement); err != nil {
			return err
		}
	}
	return nil
}
