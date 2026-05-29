import os
from sqlalchemy import create_engine, text

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./test.db")
engine = create_engine(DATABASE_URL)

def migrate():
    with engine.connect() as conn:
        try:
            conn.execute(text("ALTER TABLE cilindros_aplicados ADD COLUMN marca VARCHAR;"))
            conn.commit()
            print("Migration successful: added 'marca' column.")
        except Exception as e:
            if "duplicate column name" in str(e).lower() or "already exists" in str(e).lower():
                print("Column 'marca' already exists. Skipping.")
            else:
                print(f"Error applying migration: {e}")

if __name__ == "__main__":
    migrate()
