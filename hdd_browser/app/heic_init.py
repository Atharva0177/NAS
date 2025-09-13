def init_heic():
    """
    Idempotently register HEIC/HEIF support if pillow-heif is installed.
    """
    try:
        from pillow_heif import register_heif_opener  # type: ignore
        register_heif_opener()
    except Exception:
        # Silently ignore; endpoints will surface errors if needed.
        pass