#!/bin/bash

while true; do
  # Get the amount of free memory in kilobytes
  free_memory=$(free | awk '/Mem:/ {print $7}')

  # Check if the amount of free memory is less than 2 GB (2 * 1024 * 1024 KB)
  if [ "$free_memory" -lt 2097152 ]; then
    # Get the process ID of the whitebox_tools process with the highest memory usage
    pid=$(ps aux --sort=-%mem | awk '/whitebox_tools/ {print $2; exit}')

    echo KILLING $pid

    # Kill the process
    kill "$pid"
  fi

  # Sleep for a moment before checking again
  sleep 5
done
