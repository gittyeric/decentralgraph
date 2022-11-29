import SearchIcon from "@mui/icons-material/Search";
import IconButton from "@mui/material/IconButton";
//import LoadingButton from '@mui/lab/LoadingButton';
import TextField from "@mui/material/TextField";
import { FormEvent, useMemo, useState } from "react";
import { useDispatch } from "react-redux";
import { AppDispatch } from "../../app/store";
import { AQueried, SearchSpec } from "./graph-reducer";
//import HourglassIcon from '@mui/icons-material/HourglassEmpty';

const filterData = (query: string) => {
  let clean = query.toLowerCase().replace(/\s*/g, '').trim();
  return clean;
}

export const SearchBar = (props: {
  dispatch: ReturnType<typeof useDispatch<AppDispatch>>
  isLoading: boolean
}) => {
  const { isLoading, dispatch } = props
  const [searchQuery, setSearchQuery] = useState("")
  const [expanded, setExpanded] = useState(false)
  return useMemo(() => {
    function submitSearch(e: FormEvent<HTMLElement>): void {
      if (searchQuery) {
        dispatch({
          type: 'Queried',
          spec: {
            t: '4',
            s: searchQuery
          }
        } as AQueried<SearchSpec>)
        //setTimeout(() => setExpanded(false), 500)
      } else {
        setExpanded(false)
      }
      e.preventDefault()
    }

    function searchClicked(e: FormEvent<HTMLElement>): void {
      if (!expanded) {
        setExpanded(true)
      } else {
        submitSearch(e)
      }
      e.preventDefault()
    }

    const clazz = expanded ? '.search-bar-open' : '.search-bar-closed'
    return (
      <form onSubmit={submitSearch}>
        <TextField
          className={clazz}
          autoComplete='on'
          disabled={isLoading}
          type='text'
          onInput={(e) => {
            //@ts-ignore
            const typed = e.target.value as string
            const dataFiltered = filterData(typed)
            setSearchQuery(dataFiltered)
            e.preventDefault()
          }}
          onSubmit={submitSearch}
          label="Search Ethereum"
          variant="outlined"
          placeholder="decentralgraph.eth"
          size="small"
        />
        {
          <IconButton type="button" aria-label="search" onClick={searchClicked}>
            <SearchIcon />
          </IconButton>
        }
      </form>
    )
  }, [isLoading, expanded, searchQuery, dispatch])
}

export function NavSearch(props: {
  dispatch: ReturnType<typeof useDispatch<AppDispatch>>,
  isLoading: boolean,
}) {
  return <div id="nav-search">
    <SearchBar {...props} />
  </div>
}
