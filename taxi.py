print("Welcome to Taxi Booking Platform")
taxi = [
    {"id": 1, "curr_location": 2, "available": True},
    {"id": 2, "curr_location": 5, "available": True},
    {"id": 3, "curr_location": 7, "available": True},
    {"id": 4, "curr_location": 9, "available": True},
    {"id": 5, "curr_location": 1, "available": True},
    ]
while True:     
    pickup_location = int(input("Enter Pickup Location (1-10): "))
    drop_location = int(input("Enter Drop Location (1-10): "))
    if pickup_location < 1 or pickup_location > 10:
        print("Invalid pickup location. Enter between 1 and 10.")
        continue
    if drop_location < 1 or drop_location > 10:
        print("Invalid drop location. Enter between 1 and 10.")
        continue
    if pickup_location == drop_location:
        print("Pickup and drop locations cannot be the same.")
        continue
    distance = abs(drop_location - pickup_location)
    base = 50
    min_dist = float('inf')
    booked_taxi = None  
    for i in taxi:
        if i["available"]:
            dist = abs(i["curr_location"] - pickup_location)
            if dist < min_dist:
                min_dist = dist
                booked_taxi = i
    if booked_taxi is None:
        print("Sorry, all taxis are currently booked.")
        break
    else:
        print("Taxi booked:", booked_taxi["id"])
        booked_taxi["available"] = False
        Fare = base + (distance*20)
        print("Fare:", Fare)
        print("Travelled distance:", distance)

    booked_taxi["curr_location"] = drop_location
    print("Updated Taxi Info:", booked_taxi)

print("THANK YOU FOR USING THE SERVICE")