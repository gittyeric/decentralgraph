import ChatIcon from '@mui/icons-material/Chat';
import CloseIcon from '@mui/icons-material/Close';
import EmailIcon from '@mui/icons-material/Email';
import { Button, Dialog, DialogContent, DialogContentText, DialogTitle, IconButton, Tooltip } from '@mui/material';
import React, { useState } from 'react';
import './HomeDialog.css';

const email = 'site@decentralgraph.com'
const copyTitle = `Copied ${email} to clipboard`

export function HomeDialog(props: {forceOpen?: boolean}) {
    const [emailClicked, setEmailClicked] = useState(false)
    const [isOpen, setOpen] = useState(true || props.forceOpen)
    if (props.forceOpen !== undefined && props.forceOpen !== isOpen) {
        setOpen(props.forceOpen)
    }

    if (!isOpen) {
        return <React.Fragment />
    }

    function copyEmail() {
        setEmailClicked(true)
        navigator.clipboard.writeText(email)
    }

    function closeClicked() {
        setOpen(false)
    }

    return <Dialog onClose={closeClicked} open={isOpen} id="homeDialog" >
        <DialogTitle>Decentralgraph Alpha Build</DialogTitle>
        <IconButton size='large' className='close' onClick={closeClicked} aria-label="Close" ><CloseIcon /></IconButton>
        <DialogContent>
            <DialogContentText>
                Decentralgraph will be a multi-blockchain interactive explorer.  Welcome to the alpha build containing a random Eth chain, we'll kick off Beta with the real Ethereum chain in a few days!  Get in touch for feature requests!
          </DialogContentText>
          <DialogContentText>
              <Button target="_blank" href="https://discord.gg/yJARtpR3CF"><ChatIcon /> Chat on Discord</Button>
              <Tooltip title={copyTitle} open={emailClicked} disableFocusListener disableHoverListener disableTouchListener>
                <Button style={{display: 'none'}} onClick={copyEmail}><EmailIcon /> Email us</Button>
              </Tooltip>
          </DialogContentText>
          <Button color='secondary' onClick={closeClicked}>Continue</Button>
        </DialogContent>
    </Dialog>
}
