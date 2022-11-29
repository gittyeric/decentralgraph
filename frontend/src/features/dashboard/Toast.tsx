import { Alert, Snackbar } from "@mui/material"
import React, { useMemo, useState } from "react"
import { Notification } from "../graph/graph-reducer"
import IconButton from '@mui/material/IconButton';
import CloseIcon from '@mui/icons-material/Close';

const AUTO_CLOSE_THRESHOLD = 10000

const EMPTY_KEY = '~'

export function Toast(props: {
  notification: Notification
}) {
  const [curKey, setCurKey] = useState(EMPTY_KEY)
  const [timeoutRef, setTimeoutRef] = useState(null as ReturnType<typeof setTimeout> | null)
  const key = props.notification.t + '~' + props.notification.msg

  return useMemo(() => {
    if (timeoutRef && curKey !== key) {
      clearTimeout(timeoutRef)
    }
    const handleClose = (event: unknown, reason: string) => {
      if (reason === 'clickaway') {
        return;
      }

      setTimeoutRef(null)
    };

    if (curKey !== key) {
      setTimeoutRef(
        setTimeout(() => {
          handleClose('', '')
        }, AUTO_CLOSE_THRESHOLD + 1))
      setCurKey(key)
    }

    return <Snackbar
      anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      open={!!timeoutRef && key !== EMPTY_KEY}
      key={key}
      autoHideDuration={AUTO_CLOSE_THRESHOLD}
      onClose={(e, r) => handleClose(e, r)}
    >
      <Alert severity={props.notification.t || 'info'} sx={{ width: '100%' }}>{props.notification.msg}
        <IconButton
          size="small"
          aria-label="close"
          color="inherit"
          onClick={() => handleClose('', '')}
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      </Alert>
    </Snackbar>
  }, [timeoutRef, key, curKey, props.notification])
}
