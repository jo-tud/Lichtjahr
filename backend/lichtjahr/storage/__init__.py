"""Speicheradapter: lokaler Ordner und WebDAV mit gleicher Schnittstelle."""

from .base import Entry, Storage, StorageError, NotFound, AlreadyExists, Conflict
from .local import LocalStorage

__all__ = ["Entry", "Storage", "StorageError", "NotFound", "AlreadyExists", "Conflict", "LocalStorage"]
